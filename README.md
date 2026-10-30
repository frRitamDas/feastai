# Grace AI

Think clearly. Create freely. Grace AI is an AI workspace by Ritam Das, developed under Huracan.

## Current implementation and limitations

This repository currently contains a Next.js App Router chat application using Auth.js credentials, Drizzle/PostgreSQL, and the Vercel AI SDK's AI Gateway. It supports streaming and conversation history. The development image-upload route uses public Vercel Blob storage and does not satisfy the requested private-file requirement. Uploads and attachment-bearing chat requests are disabled in production until private storage and authorization are implemented; conversations with existing attachments cannot be continued there. The default Gateway model list is configured in source. An opt-in catalog can expose verified shared models for seven providers; it requires the catalog migrations and external encryption key. Gateway access requires its own configuration and may incur costs.

**Not production-ready:** the administrator console supports role-checked provider and model operations with TOTP, but automatic multi-provider failover and CAPTCHA-backed administrator authentication are not implemented. Existing Auth.js authentication does not provide email verification or password reset. Production chat, guest creation, login, and registration use server-side Postgres fixed-window IP counters and fail closed when the counter, trusted client IP, or a sufficiently long AUTH_SECRET is unavailable. This is not a replacement for CAPTCHA, verified email, or comprehensive abuse protection; guest sessions and authentication still require further security review before public deployment. Do not treat the requested hostname as live until independently verified.

## Setup

Use Node.js 22+ and pnpm 10.32.1. Copy `.env.example` to `.env.local` and supply the required values privately. Install with `corepack pnpm install --frozen-lockfile`. Run `corepack pnpm db:migrate` only against a verified database after reviewing the migration and backup plan; build no longer runs migrations automatically. Start with `corepack pnpm dev`. Without PostgreSQL, Auth.js cannot create users or persist chats. Vercel Blob is needed for uploads; Redis is needed for distributed IP throttling and resumable streams. AI Gateway requires credentials outside Vercel or an appropriate Vercel OIDC setup.

## Validation

Run `corepack pnpm check`, `corepack pnpm exec tsc --noEmit`, `corepack pnpm test:unit`, `corepack pnpm test`, and `corepack pnpm build`. Browser tests need the credentials described in `playwright.config.ts` and a working database. A successful build alone does not prove production readiness.

## Deployment and recovery

See [operations](docs/operations/release-and-recovery.md). Never commit secrets. Configure deployment secrets through the hosting provider. Do not promote a release without testing authentication, authorization, persistence, model access and rollback on an isolated environment. The existing database schema must be reviewed for RLS before exposing it through Supabase APIs.

This project builds on the Vercel AI SDK chatbot foundation; retain the repository's license and upstream attribution in legal notices.

## Provider foundations (not yet wired into chat)

Server-only modules include AES-256-GCM credential envelope helpers and bounded model-list discovery for Groq, OpenRouter, Cerebras, SambaNova, Mistral, Gemini and Hugging Face. Discovery results do not prove a key can run a model, and OpenRouter may return a public catalog without validating the key. A server-side catalog store and an operator CLI can persist encrypted credentials and discovery results after the migrations are applied. The administrator console and trusted CLI use these modules; the console requires an authorized account, TOTP, and an externally managed encryption key. The future vault must provide a separately managed, base64-encoded 32-byte encryption key and a tested key rotation procedure; it must never share the authentication secret. Custom endpoints and Cloudflare require separate adapters and SSRF protections. Gemini uses Google’s fixed model-list and OpenAI-compatible inference endpoints; real credentials have not been validated here.

## Catalog migration and routing foundations

Migrations `0001` and `0002` are additive: they create a disabled-by-default provider/model catalog and enable deny-by-default RLS for Auth.js-owned tables. They have been tested locally with PGlite, not applied to Supabase. Before production use, validate the actual schema, database connection role and tested backups: the app's server database role must be the table owner or an appropriately controlled BYPASSRLS role. Supabase anonymous and authenticated client roles have no policies. Existing chat operations must be verified with the exact production role after migration. Do not apply if this assumption cannot be verified.

`lib/server/routing/policy.ts` contains tested candidate filtering and fallback-safety decisions. Shared text-only models use priority-ordered keys and can retry transient HTTP failures before opening a stream; cross-provider routing is not wired in. With `GRACE_CATALOG_ENABLED=1`, the chat API can dispatch to a verified, enabled shared text-only model through fixed provider endpoints. Existing AI Gateway models remain available. The administrator console connects catalog operations to the existing verified-model chat path.

## Operator catalog

On a trusted host with `POSTGRES_URL` and a separately generated `GRACE_ENCRYPTION_KEY` (32 random bytes, base64 encoded), run `corepack pnpm catalog list`. Set `GRACE_PROVIDER_CREDENTIAL` privately in the operator environment only for `corepack pnpm catalog add groq "label"`; never put credentials in command arguments or shell history. Run `catalog discover <key-id>`, then `catalog models` to inspect IDs. Run `catalog verify <key-id> <model-id>` to perform a real small inference request (this may consume tokens or incur provider charges). An operator can use `enable-key <key-id>`, `enable-model <model-id>`, and `permit <key-id> <model-id>`; use `disable-key`, `disable-model`, `revoke`, or `delete` to withdraw access. Listing does not prove inference access. Keys and models default disabled, and removed discovery entries lose permission. No output contains saved credentials. These commands are privileged database operations; an authenticated administrator console is also available at /administrator. When the feature flag is enabled, only verified, enabled, available and explicitly permitted models appear in chat. Shared catalog models currently support text-only requests. Completed calls record provider-reported token counts when available; missing values remain unknown. Interrupted calls and costs are not comprehensively accounted for.
