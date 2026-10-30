import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { DiscoveryProvider } from "./discovery";

// Fixed origins avoid SSRF and leaking credentials to user-controlled hosts.
const origins: Record<DiscoveryProvider, string> = {
  cerebras: "https://api.cerebras.ai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  sambanova: "https://api.sambanova.ai/v1",
};

export function createProviderModel(
  provider: DiscoveryProvider,
  model: string,
  key: string,
  request?: typeof fetch
) {
  if (!Object.hasOwn(origins, provider) || !model || !key) {
    throw new Error("Provider configuration is invalid");
  }
  return createOpenAICompatible({
    apiKey: key,
    baseURL: origins[provider],
    fetch: (input, init) =>
      (request ?? fetch)(input, { ...init, redirect: "error" }),
    name: `grace-${provider}`,
  }).chatModel(model);
}
