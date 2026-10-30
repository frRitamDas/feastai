-- Singleton emergency controls; deny access to direct Supabase client roles.
CREATE TABLE "GraceSystemSetting" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "registrationEnabled" boolean NOT NULL DEFAULT true,
  "chatEnabled" boolean NOT NULL DEFAULT true,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "GraceSystemSetting" ("id") VALUES (1);
--> statement-breakpoint
ALTER TABLE "GraceSystemSetting" ENABLE ROW LEVEL SECURITY;
