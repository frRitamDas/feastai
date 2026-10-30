-- Administration is inaccessible to Supabase client roles; bootstrap is a trusted-host operation.
CREATE TABLE "GraceAdministrator" (
  "userId" uuid PRIMARY KEY REFERENCES "User"("id"),
  "role" varchar(16) NOT NULL CHECK ("role" IN ('owner', 'operator', 'viewer')),
  "enabled" boolean NOT NULL DEFAULT true,
  "totpSecret" jsonb NOT NULL,
  "lastTotpStep" bigint NOT NULL DEFAULT -1,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "GraceAdminAudit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actorId" uuid NOT NULL REFERENCES "User"("id"),
  "action" varchar(64) NOT NULL,
  "target" varchar(128),
  "outcome" varchar(24) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "GraceAdminAudit_createdAt_idx" ON "GraceAdminAudit" ("createdAt" DESC);
--> statement-breakpoint
ALTER TABLE "GraceAdministrator" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "GraceAdminAudit" ENABLE ROW LEVEL SECURITY;
