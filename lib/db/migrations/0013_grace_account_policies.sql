-- Account policy defaults preserve existing users and do not imply billing.
CREATE TABLE "GraceUserPolicy" (
  "userId" uuid PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT true,
  "hourlyQuota" integer NOT NULL DEFAULT 10 CHECK ("hourlyQuota" BETWEEN 1 AND 1000),
  "plan" varchar(32) NOT NULL DEFAULT 'free' CHECK ("plan" IN ('free', 'custom')),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "GraceQuotaCounter" (
  "userId" uuid PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "windowStart" timestamptz NOT NULL DEFAULT now(),
  "count" integer NOT NULL CHECK ("count" > 0)
);
--> statement-breakpoint
ALTER TABLE "GraceUserPolicy" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "GraceQuotaCounter" ENABLE ROW LEVEL SECURITY;
