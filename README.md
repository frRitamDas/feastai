# Grace AI

Think clearly. Create freely. Grace AI is an AI workspace by Ritam Das, developed under Huracan.

## Current implementation and limitations

This repository currently contains a Next.js App Router chat application using Auth.js credentials, Drizzle/PostgreSQL, and the Vercel AI SDK's AI Gateway. It supports streaming and conversation history. The existing image-upload route uses public Vercel Blob storage and does not satisfy the requested private-file requirement; do not enable sensitive uploads in production until it is replaced. The model list is configured in source, not verified dynamically against a credential. Gateway access requires its own configuration and may incur costs.

**Not production-ready:** the requested administrator control plane, encrypted provider vault, dynamic provider discovery, key permissions, multi-provider failover, MFA and CAPTCHA-backed administrator authentication are not implemented. Existing Auth.js authentication does not provide email verification or password reset. Guest sessions and rate limiting require further security review before public deployment. Do not treat the requested hostname as live until independently verified.

## Setup

Use Node.js 22+ and pnpm 10.32.1. Copy `.env.example` to `.env.local` and supply the required values privately. Install with `corepack pnpm install --frozen-lockfile`. Run `corepack pnpm db:migrate` only against a verified database after reviewing the migration and backup plan; build no longer runs migrations automatically. Start with `corepack pnpm dev`. Without PostgreSQL, Auth.js cannot create users or persist chats. Vercel Blob is needed for uploads; Redis is needed for distributed IP throttling and resumable streams. AI Gateway requires credentials outside Vercel or an appropriate Vercel OIDC setup.

## Validation

Run `corepack pnpm check`, `corepack pnpm exec tsc --noEmit`, `corepack pnpm test:unit`, `corepack pnpm test`, and `corepack pnpm build`. Browser tests need the credentials described in `playwright.config.ts` and a working database. A successful build alone does not prove production readiness.

## Deployment and recovery

See [operations](docs/operations/release-and-recovery.md). Never commit secrets. Configure deployment secrets through the hosting provider. Do not promote a release without testing authentication, authorization, persistence, model access and rollback on an isolated environment. The existing database schema must be reviewed for RLS before exposing it through Supabase APIs.

This project builds on the Vercel AI SDK chatbot foundation; retain the repository's license and upstream attribution in legal notices.

## Provider foundations (not yet wired into chat)

Server-only modules include AES-256-GCM credential envelope helpers and bounded model-list discovery for Groq, OpenRouter, Cerebras, SambaNova and Mistral. Discovery results do not prove a key can run a model, and OpenRouter may return a public catalog without validating the key. No credentials or catalog are persisted and no administrator APIs or UI use these modules yet. Do not deploy them as a working vault. The future vault must provide a separately managed, base64-encoded 32-byte encryption key and a tested key rotation procedure; it must never share the authentication secret. Custom endpoints, Google and Cloudflare require separate adapters and SSRF protections.

## Catalog migration and routing foundations

Migrations `0001` and `0002` are additive: they create a disabled-by-default provider/model catalog and enable deny-by-default RLS for Auth.js-owned tables. They have been tested locally with PGlite, not applied to Supabase. Before production use, validate the actual schema, database connection role and tested backups: the app's server database role must be the table owner or an appropriately controlled BYPASSRLS role. Supabase anonymous and authenticated client roles have no policies. Existing chat operations must be verified with the exact production role after migration. Do not apply if this assumption cannot be verified.

`lib/server/routing/policy.ts` contains tested candidate filtering and fallback-safety decisions. It is not wired into the chat API; the existing AI Gateway remains the only real chat path. The catalog tables are not yet connected to an admin API, and a discovered listing is not evidence that a key can run a model.
