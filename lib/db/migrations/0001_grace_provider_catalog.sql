-- Additive, server-owned provider catalog. No public Data API access is granted.
-- All previously existing user and chat tables remain untouched.
CREATE TABLE "GraceProviderKey" (
  "id" uuid PRIMARY KEY NOT NULL,
  "provider" varchar(32) NOT NULL CHECK ("provider" IN ('groq', 'openrouter', 'cerebras', 'sambanova', 'mistral')),
  "label" varchar(100) NOT NULL,
  "encryptedCredential" jsonb NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "discoveryStatus" varchar(32) NOT NULL DEFAULT 'pending',
  "lastDiscoveryAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("id", "provider")
);
--> statement-breakpoint
CREATE TABLE "GraceModel" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "provider" varchar(32) NOT NULL,
  "upstreamId" varchar(300) NOT NULL,
  "name" varchar(300) NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "firstDiscoveredAt" timestamptz NOT NULL DEFAULT now(),
  "lastDiscoveredAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("provider", "upstreamId"),
  UNIQUE ("id", "provider")
);
--> statement-breakpoint
CREATE TABLE "GraceKeyModel" (
  "keyId" uuid NOT NULL,
  "modelId" uuid NOT NULL,
  "provider" varchar(32) NOT NULL,
  "permitted" boolean NOT NULL DEFAULT false,
  "lastDiscoveredAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("keyId", "modelId"),
  FOREIGN KEY ("keyId", "provider") REFERENCES "GraceProviderKey" ("id", "provider") ON DELETE CASCADE,
  FOREIGN KEY ("modelId", "provider") REFERENCES "GraceModel" ("id", "provider") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "grace_key_model_lookup" ON "GraceKeyModel" ("modelId", "permitted");
--> statement-breakpoint
ALTER TABLE "GraceProviderKey" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "GraceModel" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "GraceKeyModel" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- No policies are created: Supabase anon/authenticated roles have no access.
-- Application connections must use an appropriately privileged server role.
