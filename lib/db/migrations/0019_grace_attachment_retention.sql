-- Preserve all pre-existing attachments: conservatively treat them as referenced.
ALTER TABLE "GraceAttachment" ADD COLUMN "usedAt" timestamptz;
--> statement-breakpoint
UPDATE "GraceAttachment" SET "usedAt" = "createdAt";
