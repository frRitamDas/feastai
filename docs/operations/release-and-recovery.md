# Release and recovery

## Safety gate

Record the commit and last known-good deployment. Check secret *presence*, never values. Run lint, type checking, tests and build. Verify database connectivity and review each migration for compatibility with both releases, locks, and destructive operations. Confirm a tested backup and recovery point before migrations. Run migrations as an explicit operation, not during a build. Test a protected preview with real authentication, authorization, persistence, and a controlled provider; promote only after all critical tests pass. This repository does not implement an automated promotion gate or rollback monitor.

## Rollback and database recovery

Stop promotion on a failed migration or smoke test. Inspect actual migration history and schema before any repair. Never reset or truncate production and never automatically roll back schema. Use expand/transition/contract migrations; do not remove old structures in the release introducing replacements. Check compatibility with the last known-good release, then use Vercel's supported rollback action and repeat smoke tests. Preserve logs. Restore a verified Supabase backup only after assessing potential data loss. Backup retention, RPO and RTO depend on the actual plan and have not been verified.

## Incidents

Distinguish application errors from database, hosting and upstream outages; do not roll back for one provider's transient failure. Disable/revoke exposed credentials at their issuer, rotate runtime secrets, revoke affected sessions, review safe logs, and validate replacements without recording secrets. Administrator recovery must use an authorized identity/deployment channel, never an authentication bypass. The requested administrator vault, emergency switches and incident audit trail do not yet exist. No automatic failover or rollback is claimed.

## Smoke tests

Check the homepage, permitted sign-in and session validation, anonymous and ordinary-user denial of privileged endpoints, database reads/writes with safe test records, configured provider response, streaming, persistence and model selection. Test fallback with a controlled mock once implemented. Do not consume production tokens unnecessarily. Record failures and operator actions without secrets.
