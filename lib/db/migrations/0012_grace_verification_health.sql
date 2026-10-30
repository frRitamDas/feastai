-- Actual last verification observations; NULL means no observation.
ALTER TABLE "GraceKeyModel" ADD COLUMN "lastCheckAt" timestamptz;
--> statement-breakpoint
ALTER TABLE "GraceKeyModel" ADD COLUMN "lastCheckStatus" varchar(32);
--> statement-breakpoint
ALTER TABLE "GraceKeyModel" ADD COLUMN "lastLatencyMs" integer CHECK ("lastLatencyMs" >= 0);
