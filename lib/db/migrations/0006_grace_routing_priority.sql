ALTER TABLE "GraceProviderKey" ADD COLUMN "priority" integer NOT NULL DEFAULT 50 CHECK ("priority" BETWEEN 0 AND 100);
