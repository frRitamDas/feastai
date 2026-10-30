-- Server-only fixed-window request counters. IP addresses are never stored.
CREATE TABLE IF NOT EXISTS "GraceRateLimit" (
  "key" text PRIMARY KEY,
  "windowStart" timestamptz NOT NULL DEFAULT now(),
  "count" integer NOT NULL CHECK ("count" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "GraceRateLimit_windowStart_idx" ON "GraceRateLimit" ("windowStart");
--> statement-breakpoint
ALTER TABLE "GraceRateLimit" ENABLE ROW LEVEL SECURITY;
