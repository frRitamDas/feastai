// lib/ai/models.ts
import { createGroq } from '@ai-sdk/groq';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

export const models = [
  // ⚡ SUPERGROK HEAVY TIER (Deep Chain-of-Thought Reasoning)
  {
    id: 'supergrok-heavy',
    label: 'SuperGrok Heavy (DeepSeek R1)',
    apiIdentifier: 'deepseek-r1-distill-llama-70b',
    provider: groq,
    tier: 'heavy',
    description: 'Unfiltered, maximum reasoning power with visible thinking trace.',
  },
  // 🚀 SUPERGROK FAST (Daily Driver)
  {
    id: 'supergrok-fast',
    label: 'SuperGrok Fast (Llama 3.3 70B)',
    apiIdentifier: 'llama-3.3-70b-versatile',
    provider: groq,
    tier: 'free',
    description: 'Ultra-low latency streaming for general conversation.',
  },
  // 🧠 CHATGPT PRO TIER (Multimodal + Deep Context)
  {
    id: 'chatgpt-pro',
    label: 'ChatGPT Pro (Gemini 2.5 Flash)',
    apiIdentifier: 'gemini-2.5-flash',
    provider: google,
    tier: 'pro',
    description: '1M+ context window, live web search grounding, and vision.',
  },
  // 💻 CODEX / BUILD MODE (Specialized Code Generation)
  {
    id: 'codex-build',
    label: 'Codex / Build Engine',
    apiIdentifier: 'qwen-2.5-coder-32b',
    provider: groq,
    tier: 'pro',
    description: 'Optimized for full-stack architecture, debugging, and codebases.',
  },
];
