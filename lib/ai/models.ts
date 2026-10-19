import { createGroq } from '@ai-sdk/groq';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Title model required by providers.ts
export const titleModel = groq('llama-3.3-70b-versatile');

export const DEFAULT_MODEL_NAME = 'llama-3.3-70b-versatile';

export interface Model {
  id: string;
  label: string;
  apiIdentifier: string;
  provider: any;
  tier?: string;
  description: string;
}

export const models: Model[] = [
  {
    id: 'deepseek-r1-distill-llama-70b',
    label: 'SuperGrok Heavy (DeepSeek R1)',
    apiIdentifier: 'deepseek-r1-distill-llama-70b',
    provider: groq,
    tier: 'heavy',
    description: 'Unfiltered, maximum reasoning power with visible thinking trace.',
  },
  {
    id: 'llama-3.3-70b-versatile',
    label: 'SuperGrok Fast (Llama 3.3 70B)',
    apiIdentifier: 'llama-3.3-70b-versatile',
    provider: groq,
    tier: 'free',
    description: 'Ultra-low latency streaming for general conversation.',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'ChatGPT Pro (Gemini 2.5 Flash)',
    apiIdentifier: 'gemini-2.5-flash',
    provider: google,
    tier: 'pro',
    description: '1M+ context window, live web search grounding, and vision.',
  },
  {
    id: 'qwen-2.5-coder-32b',
    label: 'Codex / Build Engine',
    apiIdentifier: 'qwen-2.5-coder-32b',
    provider: groq,
    tier: 'pro',
    description: 'Optimized for full-stack architecture, debugging, and codebases.',
  },
];

// Helper required by /api/models route to check model access
export function getModelAvailability(modelId: string, userTier?: string) {
  const model = models.find((m) => m.id === modelId);
  if (!model) return false;
  if (!model.tier || model.tier === 'free') return true;
  if (userTier === 'heavy') return true;
  if (userTier === 'pro' && model.tier === 'pro') return true;
  return false;
}

// Expose a simple demo flag. Set process.env.DEMO or NEXT_PUBLIC_DEMO to "true" to enable demo mode.
export const isDemo =
  process.env.DEMO === 'true' || process.env.NEXT_PUBLIC_DEMO === 'true' || process.env.NODE_ENV !== 'production';

// Return all gateway models. In production this could fetch from an external gateway; here we
// return the static list defined above so the /api/models route can work without external deps.
export async function getAllGatewayModels() {
  return models;
}

// Helper required by /api/models route to check capabilities (vision, tools, artifacts)
// This function supports two usages:
// - getCapabilities(modelId: string) -> returns capabilities for a single model
// - getCapabilities() -> returns a mapping of modelId -> capabilities for all models
export function getCapabilities(modelId?: string) {
  const single = (id: string) => {
    if (id === 'gemini-2.5-flash') {
      return {
        vision: true,
        webSearch: true,
        artifacts: true,
      };
    }
    return {
      vision: false,
      webSearch: false,
      artifacts: true,
    };
  };

  if (typeof modelId === 'string') {
    return single(modelId);
  }

  // No modelId -> return mapping for all known models
  const map: Record<string, { vision: boolean; webSearch: boolean; artifacts: boolean }> = {};
  for (const m of models) {
    map[m.id] = single(m.id);
  }
  return map;
}
