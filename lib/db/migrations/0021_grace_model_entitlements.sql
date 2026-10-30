-- Manual, expiring entitlements. Existing accounts and catalog entries retain
-- their current access; no billing provider or payment state is implied.
ALTER TABLE "GraceUserPolicy" ADD COLUMN "planExpiresAt" timestamptz;
--> statement-breakpoint
ALTER TABLE "GraceModel" ADD COLUMN "requiredPlan" varchar(32) NOT NULL DEFAULT 'free' CHECK ("requiredPlan" IN ('free', 'custom'));
--> statement-breakpoint
ALTER TABLE "GraceRouteGroup" ADD COLUMN "requiredPlan" varchar(32) NOT NULL DEFAULT 'free' CHECK ("requiredPlan" IN ('free', 'custom'));
--> statement-breakpoint
-- Preserve existing accounts while making case-insensitive login efficient.
CREATE INDEX IF NOT EXISTS "User_email_lower_idx" ON "User" (lower("email"));
