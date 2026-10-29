# Grace AI

**Grace AI** is a thoughtful AI workspace for writing, learning, coding, research, brainstorming, and everyday questions.

Grace is built on the Next.js App Router and Vercel AI SDK. This repository started from the open-source Vercel AI chatbot template; review the upstream license and notices before redistribution.

## Product principles

- Clean, responsive, accessible interface for desktop, tablet, and mobile
- Streaming AI conversations built on the existing chat endpoint
- Thoughtful model selection through the existing AI Gateway integration
- Secure server-side secrets and authenticated persistence
- Keyboard-friendly interactions and reduced-motion support
- Honest error handling: no fabricated responses or fake tool results

## Stack

- Next.js App Router, React, TypeScript
- Vercel AI SDK and AI Gateway
- Tailwind CSS 4, Radix UI/shadcn component foundations, Lucide icons
- Auth.js, Drizzle ORM, PostgreSQL, optional Redis and Vercel Blob integrations already present in the template

## Environment

Review `.env.example`. Set up the required environment variables in your deployment platform; never commit production secrets. The chat route expects the model provider configuration already included in `lib/ai/providers.ts`. For persistent accounts and history, configure the database and run migrations as described below.

## Local development

Use Node.js supported by the installed Next.js release and pnpm.

```bash
pnpm install
cp .env.example .env.local
# Fill in valid values for the services you use
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000.

## Build

```bash
pnpm check
pnpm build
```

A production build requires compatible environment configuration. Never add secrets directly to source code or client-side variables.

## Grace AI brand

- Product: Grace AI
- Short name: Grace
- Tagline: Think clearly. Make something meaningful.
- Visual identity: near-black surfaces, soft violet light, restrained blue accents, readable typography and reduced-motion-aware transitions

## Roadmap

1. Grace AI brand and responsive conversation workspace
2. Verified model configuration and graceful provider failures
3. Persistent conversation search and renaming
4. Real attachment parsing and multimodal prompts
5. Explicit web-search integration with sourced results
6. User preferences, export/delete controls, and usage limits
7. Automated accessibility, unit, and browser tests
