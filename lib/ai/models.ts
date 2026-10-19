import { createGroq } from '@ai-sdk/groq';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Required by providers.ts to generate conversation titles
export const titleModel = groq('llama-3.3-70b-versatile');

export const DEFAULT_MODEL_NAME = 'llama-3.3-70b-versatile';

export const models = [
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
