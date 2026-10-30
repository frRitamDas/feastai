-- Provider attribution is nullable when the upstream does not report it.
ALTER TABLE "GraceUsageEvent" ADD COLUMN "provider" varchar(32);
--> statement-breakpoint
ALTER TABLE "GraceUsageEvent" ADD COLUMN "upstreamModel" varchar(300);
