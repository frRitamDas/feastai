-- Private server-mediated attachment storage; direct Supabase Data API access is denied.
CREATE TABLE "GraceAttachment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "name" varchar(100) NOT NULL,
  "mediaType" varchar(32) NOT NULL CHECK ("mediaType" IN ('image/jpeg', 'image/png', 'text/plain')),
  "data" bytea NOT NULL CHECK (octet_length("data") BETWEEN 1 AND 2097152),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "GraceAttachment_userId_idx" ON "GraceAttachment" ("userId");
--> statement-breakpoint
ALTER TABLE "GraceAttachment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Earlier guest accounts used synthetic addresses but were not marked anonymous.
UPDATE "User" SET "isAnonymous" = true WHERE "email" ~ '^guest-[0-9]+$' AND "isAnonymous" = false;
