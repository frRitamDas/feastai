# Grace AI

Grace AI is a conversational AI workspace by Ritam Das, built on the Vercel AI SDK chatbot foundation. It uses Next.js, Auth.js, PostgreSQL/Drizzle, and a server-side encrypted provider catalog.

## Features

- Responsive chat with streamed responses, conversation history, Markdown and code, model selection, profile settings, and private JPEG, PNG, and text attachments. Shared models support images only when an administrator explicitly marks them as vision-capable; every candidate in an automatic route must support images for the route to accept them.
- An unlinked `/administrator` console with role-scoped access, TOTP MFA, provider credentials and model discovery/verification, routing, connection health, usage, users, quotas, manual model entitlements, announcements, audit events, and emergency switches.
- Provider adapters for Groq, OpenRouter, Gemini, Cerebras, SambaNova, Cloudflare Workers AI, Mistral, Hugging Face, and allowlisted OpenAI-compatible services. Credentials are encrypted at rest, never returned to the browser after submission, and used server-side. Providers must be configured and verified with real credentials before use.
- Priority-based multi-key routing and explicitly configured cross-provider routes. Fallback is bounded and occurs only before a stream opens; request errors, tool use, caller cancellation, and partial streams are not retried. Connection opening latency and failures are operational signals, not proof of completed responses.
- Server-enforced free/custom access tiers and optional expiry. These are manually granted entitlements, **not billing, payments, or automatic subscriptions**.

## Security and limitations

Production registration, first-owner setup, and administrator MFA require hostname- and action-bound Cloudflare Turnstile. Authentication and chat requests also use server-side PostgreSQL rate counters that fail closed if their trusted IP or database is unavailable. The database connection must use a trusted server-only role; application tables use deny-by-default RLS for unprivileged Supabase roles. Never expose database credentials, encryption keys, provider credentials, or Turnstile secrets to client code.

Auth.js credentials authentication does **not** include email verification or password reset. Guest access, deployment configuration, abuse defenses, key recovery, backups, and access controls require an independent security and operational review before commercial use. Usage records are best-effort for completed calls; interrupted calls, provider costs, and externally incurred charges are not comprehensive. Uploaded files persist independently of deleted chats and require an operator-managed retention policy.

## Local setup

Use Node.js 22+ and pnpm 10.32.1. Copy `.env.example` to `.env.local`, provide secrets privately, and run:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm db:migrate   # only after reviewing the target database and migration history
corepack pnpm dev
```

A PostgreSQL database is required for users, rate limits, and persistence. Files are stored privately in PostgreSQL; Vercel Blob and Redis are not required for attachments or rate limiting. AI Gateway models are separately available when Gateway credentials or Vercel OIDC are configured; catalog providers use their own credentials. See [administrator operations](docs/operations/administration.md) for first-owner setup and provider enrollment.

## Validation and deployment

Run `corepack pnpm check`, `corepack pnpm exec tsc --noEmit`, `corepack pnpm test:unit`, `corepack pnpm test:integration`, and `corepack pnpm build`. For the isolated HTTPS browser smoke test (requires OpenSSL), build locally with `NEXT_PUBLIC_GRACE_TURNSTILE_SITE_KEY=integration-only-site-key corepack pnpm build`, then run `GRACE_BROWSER_EXECUTABLE=/path/to/chromium corepack pnpm test:browser:smoke`. That key is only a test fixture and must not be deployed. The HTTP and browser suites use isolated test-only mocks and do not validate real provider credentials, Vercel BotID, Turnstile, or a production deployment. The larger Playwright suite requires its configured database and credentials.

Builds do not apply migrations automatically. Before deployment, verify backups, both relevant migration histories, database privileges, required secrets, real provider inference, and rollback; see [release and recovery](docs/operations/release-and-recovery.md). A successful build alone is not a production readiness check.
