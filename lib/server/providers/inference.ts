import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { cloudflareBaseUrl, parseCloudflareCredential } from "./cloudflare";
import { customProviderFetch, parseCustomCredential } from "./custom";
import type { DiscoveryProvider } from "./discovery";

// Fixed origins avoid SSRF and leaking credentials to user-controlled hosts.
const origins: Record<DiscoveryProvider, string> = {
  cerebras: "https://api.cerebras.ai/v1",
  cloudflare: "https://api.cloudflare.com/client/v4/accounts",
  custom: "https://invalid.example",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  huggingface: "https://router.huggingface.co/v1",
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
  const cloudflare =
    provider === "cloudflare" ? parseCloudflareCredential(key) : null;
  const custom = provider === "custom" ? parseCustomCredential(key) : null;
  const makeRequest = custom
    ? customProviderFetch(custom.baseUrl, request ?? fetch)
    : (request ?? fetch);
  return createOpenAICompatible({
    apiKey: cloudflare?.apiToken ?? custom?.apiKey ?? key,
    baseURL: cloudflare
      ? `${cloudflareBaseUrl(cloudflare.accountId)}/v1`
      : (custom?.baseUrl ?? origins[provider]),
    fetch: (input, init) => makeRequest(input, { ...init, redirect: "error" }),
    name: `grace-${provider}`,
  }).chatModel(model);
}
