/** Fixed provider endpoints only. Custom URLs need a separate SSRF-safe design. */
const providers = {
  cerebras: "https://api.cerebras.ai/v1/models",
  groq: "https://api.groq.com/openai/v1/models",
  mistral: "https://api.mistral.ai/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
  sambanova: "https://api.sambanova.ai/v1/models",
} as const;

export type DiscoveryProvider = keyof typeof providers;
export type DiscoveredModel = { id: string; name: string };
export type DiscoveryResult =
  | { models: DiscoveredModel[]; status: "discovered" }
  | {
      retryAfterSeconds?: number;
      status:
        | "authentication_failed"
        | "rate_limited"
        | "unavailable"
        | "invalid_response";
    };

/** Listing a model does not prove inference access or imply public enablement. */
export function normalizeModels(payload: unknown): DiscoveredModel[] | null {
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    return null;
  }
  const { data } = payload;
  if (!Array.isArray(data) || data.length > 10_000) {
    return null;
  }
  const models = new Map<string, DiscoveredModel>();
  for (const item of data) {
    if (!item || typeof item !== "object" || typeof item.id !== "string") {
      continue;
    }
    const id = item.id.trim();
    if (!id || id.length > 300 || models.has(id)) {
      continue;
    }
    const name =
      typeof item.name === "string" && item.name.trim().length <= 300
        ? item.name.trim() || id
        : id;
    models.set(id, { id, name });
  }
  return [...models.values()];
}

export function parseRetryAfter(
  value: string | null,
  now = Date.now()
): number | undefined {
  if (!value) {
    return;
  }
  if (/^\d+$/.test(value)) {
    return Math.min(Number(value), 86_400);
  }
  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, Math.min(Math.ceil((timestamp - now) / 1000), 86_400));
  }
}

export async function discoverModels(
  provider: DiscoveryProvider,
  credential: string,
  request: typeof fetch = fetch
): Promise<DiscoveryResult> {
  // Runtime validation is essential even though TypeScript narrows callers.
  if (
    !Object.hasOwn(providers, provider) ||
    !credential ||
    credential.length > 8192 ||
    /[\r\n]/.test(credential)
  ) {
    return { status: "invalid_response" };
  }
  try {
    const response = await request(providers[provider], {
      headers: { Authorization: `Bearer ${credential}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) {
      return { status: "authentication_failed" };
    }
    if (response.status === 429) {
      return {
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
        status: "rate_limited",
      };
    }
    if (!response.ok) {
      return { status: "unavailable" };
    }
    // Bound data even when Content-Length is missing or untrustworthy.
    const reader = response.body?.getReader();
    if (!reader) {
      return { status: "invalid_response" };
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      // The stream must be consumed in order and bounded before buffering.
      // biome-ignore lint/performance/noAwaitInLoops: Sequential reads enforce the response size limit.
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      length += value.length;
      if (length > 2_000_000) {
        await reader.cancel();
        return { status: "invalid_response" };
      }
      chunks.push(value);
    }
    const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const models = normalizeModels(payload);
    return models
      ? { models, status: "discovered" }
      : { status: "invalid_response" };
  } catch {
    // Do not return upstream response bodies or network errors: they may contain secrets.
    return { status: "unavailable" };
  }
}
