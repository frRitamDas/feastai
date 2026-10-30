-- Additive runtime routing observations and explicit, operator-controlled vision support.
-- Existing models remain text-only and routes preserve their current priority order.
ALTER TABLE "GraceModel" ADD COLUMN "supportsVision" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "GraceKeyModel" ADD COLUMN "connectionsOpened" integer NOT NULL DEFAULT 0 CHECK ("connectionsOpened" >= 0);
--> statement-breakpoint
ALTER TABLE "GraceKeyModel" ADD COLUMN "connectionFailures" integer NOT NULL DEFAULT 0 CHECK ("connectionFailures" >= 0);
--> statement-breakpoint
ALTER TABLE "GraceKeyModel" ADD COLUMN "lastRuntimeAt" timestamptz;
--> statement-breakpoint
ALTER TABLE "GraceKeyModel" ADD COLUMN "lastRuntimeStatus" varchar(32);
--> statement-breakpoint
ALTER TABLE "GraceKeyModel" ADD COLUMN "lastRuntimeLatencyMs" integer CHECK ("lastRuntimeLatencyMs" >= 0);
--> statement-breakpoint
ALTER TABLE "GraceKeyModel" ADD COLUMN "cooldownUntil" timestamptz;
--> statement-breakpoint
ALTER TABLE "GraceRouteGroup" ADD COLUMN "strategy" varchar(16) NOT NULL DEFAULT 'manual' CHECK ("strategy" IN ('manual', 'fastest', 'reliable', 'balanced'));
