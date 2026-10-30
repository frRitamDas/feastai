/** Fixed provider endpoints only. Custom URLs need a separate SSRF-safe design. */
const providers = {
  cerebras: "https://api.cerebras.ai/v1/models",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
  groq: "https://api.groq.com/openai/v1/models",
  huggingface: "https://router.huggingface.co/v1/models",
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
    const models = new Map<string, DiscoveredModel>();
    let pageToken: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const url = new URL(providers[provider]);
      if (provider === "gemini") {
        url.searchParams.set("pageSize", "1000");
        if (pageToken) {
          url.searchParams.set("pageToken", pageToken);
        }
      }
      // Pages are fetched sequentially and only from the fixed provider origin.
      // biome-ignore lint/performance/noAwaitInLoops: Pagination depends on the preceding response.
      const response = await request(url.toString(), {
        headers:
          provider === "gemini"
            ? { "x-goog-api-key": credential }
            : { Authorization: `Bearer ${credential}` },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 401 || response.status === 403) {
        return { status: "authentication_failed" };
      }
      if (response.status === 429) {
        return {
          retryAfterSeconds: parseRetryAfter(
            response.headers.get("retry-after")
          ),
          status: "rate_limited",
        };
      }
      if (!response.ok) {
        return { status: "unavailable" };
      }
      let payload: unknown;
      try {
        payload = await readBoundedJson(response);
      } catch {
        return { status: "invalid_response" };
      }
      if (provider !== "gemini") {
        const normalized = normalizeModels(payload);
        return normalized
          ? { models: normalized, status: "discovered" }
          : { status: "invalid_response" };
      }
      const parsed = normalizeGeminiPage(payload);
      if (!parsed) {
        return { status: "invalid_response" };
      }
      for (const model of parsed.models) {
        models.set(model.id, model);
      }
      if (models.size > 10_000) {
        return { status: "invalid_response" };
      }
      if (!parsed.nextPageToken) {
        return { models: [...models.values()], status: "discovered" };
      }
      if (pageToken === parsed.nextPageToken) {
        return { status: "invalid_response" };
      }
      pageToken = parsed.nextPageToken;
    }
    // Never publish partial listings: doing so could disable models that were not fetched.
    return { status: "invalid_response" };
  } catch {
    // Do not return upstream response bodies or network errors: they may contain secrets.
    return { status: "unavailable" };
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Missing response body");
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    // biome-ignore lint/performance/noAwaitInLoops: Read sequentially to enforce the size limit.
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    length += value.length;
    if (length > 2_000_000) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function normalizeGeminiPage(
  payload: unknown
): { models: DiscoveredModel[]; nextPageToken?: string } | null {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("models" in payload) ||
    !Array.isArray(payload.models) ||
    payload.models.length > 10_000
  ) {
    return null;
  }
  const rawToken =
    "nextPageToken" in payload ? payload.nextPageToken : undefined;
  if (
    rawToken !== undefined &&
    (typeof rawToken !== "string" || rawToken.length > 1024)
  ) {
    return null;
  }
  const models: DiscoveredModel[] = [];
  for (const item of payload.models) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.name !== "string" ||
      !item.name.startsWith("models/") ||
      !Array.isArray(item.supportedGenerationMethods) ||
      !item.supportedGenerationMethods.includes("generateContent")
    ) {
      continue;
    }
    const id = item.name.slice(7);
    if (!id || id.length > 300) {
      continue;
    }
    const name =
      typeof item.displayName === "string" &&
      item.displayName.trim().length <= 300
        ? item.displayName.trim() || id
        : id;
    models.push({ id, name });
  }
  return { models, nextPageToken: rawToken || undefined };
}
