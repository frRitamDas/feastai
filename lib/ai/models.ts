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

// Helper required by /api/models route to check capabilities (vision, tools, artifacts)
export function getCapabilities(modelId: string) {
  if (modelId === 'gemini-2.5-flash') {
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
}
