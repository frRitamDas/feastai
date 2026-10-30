import { APICallError, type LanguageModelV4 } from "@ai-sdk/provider";
import type { DiscoveryProvider } from "./discovery";
import { createProviderModel } from "./inference";

type Candidate = {
  provider: DiscoveryProvider;
  upstreamId: string;
  credential: string;
};

/** Retry only a failed initial HTTP request, never after a stream is returned. */
export function createFallbackModel(
  candidates: Candidate[],
  request?: typeof fetch
): LanguageModelV4 {
  if (!candidates.length || candidates.length > 3) {
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
  const retryable = (error: unknown, aborted: boolean) =>
    !aborted &&
    APICallError.isInstance(error) &&
    (error.statusCode === 429 ||
      (typeof error.statusCode === "number" && error.statusCode >= 500));
  return {
    async doGenerate(options) {
      return await first.doGenerate(options);
    },
    async doStream(options) {
      for (const [index, model] of models.entries()) {
        try {
          // biome-ignore lint/performance/noAwaitInLoops: Fallback must be sequential and only after a failed attempt.
          return await model.doStream(options);
        } catch (error) {
          if (
            index === models.length - 1 ||
            options.tools?.length ||
            !retryable(error, options.abortSignal?.aborted === true)
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
