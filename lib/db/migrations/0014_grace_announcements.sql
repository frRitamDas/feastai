-- Server-managed announcements. Public access is mediated by the application.
CREATE TABLE "GraceAnnouncement" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" varchar(120) NOT NULL,
  "body" text NOT NULL CHECK (char_length("body") BETWEEN 1 AND 2000),
  "enabled" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "GraceAnnouncement" ENABLE ROW LEVEL SECURITY;
