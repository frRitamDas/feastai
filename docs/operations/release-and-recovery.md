# Release and recovery

## Safety gate

Record the commit and last known-good deployment; check secret **presence**, never values. Run lint, type checking, unit/integration tests, and a production build. Verify database connectivity and review each migration for compatibility, locks, and destructive operations. Confirm a tested backup and recovery point before migration. Run migrations as an explicit operation, not during a build. Test authentication, authorization, persistence, administrator MFA, a real configured provider, streaming and rollback in a protected environment before promoting. This repository does not implement automated promotion or rollback monitoring.

Auth.js does not provide email verification or password reset. Manual custom entitlements are not payment processing or billing. Provider validation in local tests uses mocks and is not evidence of a live integration. Do not mark a release commercially ready without independent security, abuse, backup, operational and real-provider checks.

## Migration history

Supabase's migration history and Drizzle's `drizzle.__drizzle_migrations` are separate. Compare **both** with the actual schema and the repository journal before applying migrations to an existing project; never blindly replay old migrations. When applying a reviewed repository migration through Supabase tooling, coordinate the corresponding Drizzle hash and journal timestamp in the same transaction, and verify both histories afterward. Do not invent migration hashes or timestamps. The existing server-only database role must retain the privileges needed by the Auth.js application, while Supabase anonymous and authenticated roles remain denied by RLS.

## Rollback and recovery

Stop promotion on a failed migration or smoke test. Inspect actual history and schema before repair. Never reset or truncate production and never automatically roll back schema. Use expand/transition/contract migrations. Check compatibility with the last known-good release, then use Vercel's supported rollback action and repeat smoke tests. Preserve safe logs. Restore a verified Supabase backup only after assessing potential data loss. Backup retention, RPO and RTO depend on the actual plan and must be verified.

Distinguish application errors from database, hosting and upstream outages; do not roll back for one provider's transient failure. Disable/revoke exposed credentials at their issuer, rotate affected secrets, revoke affected sessions, inspect audit events, and validate replacements without recording secrets. Owner-only system settings can pause registration or chat; they do not delete data. Administrator recovery requires an authorized identity/deployment channel, never an authentication bypass. The AES encryption key protects both provider credentials and TOTP seeds, so its loss requires a carefully managed recovery and reenrollment process.

## Smoke tests

Check the homepage, Turnstile-protected registration, regular sign-in and session validation, anonymous and ordinary-user denial of administrator endpoints, MFA and replay rejection, database reads/writes with safe test records, a configured real provider response, streaming, private attachment isolation, persistence, model selection, manual entitlements, and emergency switches. Confirm provider fallback with a controlled test rather than consuming unnecessary production tokens. Record failures and operator actions without secrets.

## Rate limit operation

Server-only, RLS-protected fixed-window counters cover chat, guest creation, login, registration, and administrator verification. Keys are HMACs using `AUTH_SECRET`, not raw IP addresses. Production requests fail closed if `AUTH_SECRET` is shorter than 32 characters, the trusted Vercel client IP is absent, or the database counter is unavailable. Deploy only behind a trusted proxy that replaces `x-real-ip`; do not trust this header from direct public clients. Counters do not prevent distributed abuse and do not replace CAPTCHA.

Expired counter rows are not pruned automatically. An operator can schedule bounded deletion of rows with `"windowStart" < now() - interval '24 hours'`, using the trusted database role, and monitor table size. Rotating `AUTH_SECRET` resets effective counters and invalidates Auth.js sessions.
