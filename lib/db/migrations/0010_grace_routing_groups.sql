-- Operator-defined aliases make cross-provider fallback an explicit choice.
CREATE TABLE "GraceRouteGroup" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "GraceRouteMember" (
  "routeId" uuid NOT NULL REFERENCES "GraceRouteGroup"("id") ON DELETE CASCADE,
  "modelId" uuid NOT NULL REFERENCES "GraceModel"("id") ON DELETE CASCADE,
  "priority" integer NOT NULL DEFAULT 50 CHECK ("priority" BETWEEN 0 AND 100),
  PRIMARY KEY ("routeId", "modelId")
);
--> statement-breakpoint
ALTER TABLE "GraceRouteGroup" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "GraceRouteMember" ENABLE ROW LEVEL SECURITY;
