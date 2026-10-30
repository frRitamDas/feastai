-- Password changes invalidate previously issued Auth.js sessions.
ALTER TABLE "User" ADD COLUMN "sessionVersion" integer NOT NULL DEFAULT 0 CHECK ("sessionVersion" >= 0);
