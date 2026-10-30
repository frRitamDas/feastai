import { APICallError, type LanguageModelV4 } from "@ai-sdk/provider";
import type { DiscoveryProvider } from "./discovery";
import { createProviderModel } from "./inference";

type Candidate = {
  provider: DiscoveryProvider;
  upstreamId: string;
  credential: string;
  keyId?: string;
  modelId?: string;
};

export type ConnectionStatus =
  | "opened"
  | "authentication_failed"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "invalid_request";

export type ConnectionObservation = {
  keyId?: string;
  modelId?: string;
  status: ConnectionStatus;
  latencyMs: number;
};

function classifyFailure(error: unknown, timedOut: boolean): ConnectionStatus {
  if (timedOut) {
    return "timeout";
  }
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return "authentication_failed";
    }
    if (error.statusCode === 429) {
      return "rate_limited";
    }
    if (
      error.statusCode === 408 ||
      (typeof error.statusCode === "number" && error.statusCode >= 500) ||
      (error.statusCode === undefined &&
        (error.isRetryable || error.cause instanceof TypeError))
    ) {
      return "unavailable";
    }
    return "invalid_request";
  }
  return error instanceof TypeError ? "unavailable" : "invalid_request";
}

/**
 * Candidates are pre-authorized by the catalog. Retry only before a stream is
 * handed to the caller; replay after output or tool side effects is unsafe.
 * The per-attempt timeout ends when headers arrive, not while tokens stream.
 */
export function createFallbackModel(
  candidates: Candidate[],
  request?: typeof fetch,
  onSelected?: (selected: {
    provider: DiscoveryProvider;
    upstreamId: string;
  }) => void,
  onConnection?: (observation: ConnectionObservation) => Promise<void> | void,
  attemptTimeoutMs = 12_000
): LanguageModelV4 {
  if (
    !candidates.length ||
    candidates.length > 3 ||
    !Number.isInteger(attemptTimeoutMs) ||
    attemptTimeoutMs < 1 ||
    attemptTimeoutMs > 60_000
  ) {
    throw new Error("Invalid routing candidates");
  }
  const models = candidates.map((candidate) =>
    createProviderModel(
      candidate.provider,
      candidate.upstreamId,
      candidate.credential,
      request
    )
  );
  const [first] = models;
  const observe = async (
    candidate: Candidate,
    status: ConnectionStatus,
    started: number
  ) => {
    try {
      await onConnection?.({
        keyId: candidate.keyId,
        latencyMs: Math.min(Date.now() - started, 2_147_483_647),
        modelId: candidate.modelId,
        status,
      });
    } catch {
      // A monitoring failure must not expose credentials or break inference.
      console.error("Unable to record provider connection health");
    }
  };
  return {
    async doGenerate(options) {
      const result = await first.doGenerate(options);
      onSelected?.({
        provider: candidates[0].provider,
        upstreamId: candidates[0].upstreamId,
      });
      return result;
    },
    async doStream(options) {
      for (const [index, model] of models.entries()) {
        const candidate = candidates[index];
        const started = Date.now();
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), attemptTimeoutMs);
        const signal = options.abortSignal
          ? AbortSignal.any([options.abortSignal, timeout.signal])
          : timeout.signal;
        try {
          // biome-ignore lint/performance/noAwaitInLoops: Each attempt must finish before the next can start.
          const stream = await model.doStream({
            ...options,
            abortSignal: signal,
          });
          clearTimeout(timer);
          await observe(candidate, "opened", started);
          onSelected?.({
            provider: candidate.provider,
            upstreamId: candidate.upstreamId,
          });
          return stream;
        } catch (error) {
          clearTimeout(timer);
          if (options.abortSignal?.aborted) {
            throw error;
          }
          const status = classifyFailure(error, timeout.signal.aborted);
          await observe(candidate, status, started);
          if (
            index === models.length - 1 ||
            options.tools?.length ||
            status === "invalid_request"
          ) {
            throw error;
          }
        }
      }
      throw new Error("No eligible provider available");
    },
    modelId: first.modelId,
    provider: first.provider,
    specificationVersion: "v4",
    supportedUrls: {},
  };
}
