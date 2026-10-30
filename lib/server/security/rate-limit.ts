import { createHmac } from "node:crypto";

// The single upsert serializes increments for the same key across instances.
export const RATE_LIMIT_SQL = `
INSERT INTO "GraceRateLimit" ("key", "windowStart", "count")
VALUES ($1, now(), 1)
ON CONFLICT ("key") DO UPDATE SET
  "windowStart" = CASE WHEN "GraceRateLimit"."windowStart" <= now() - interval '1 hour'
    THEN now() ELSE "GraceRateLimit"."windowStart" END,
  "count" = CASE WHEN "GraceRateLimit"."windowStart" <= now() - interval '1 hour'
    THEN 1 ELSE "GraceRateLimit"."count" + 1 END
RETURNING "count"`;

export type RateLimitScope =
  | "chat"
  | "login"
  | "guest"
  | "register"
  | "admin"
  | "admin-action";
export const LIMITS: Record<RateLimitScope, number> = {
  admin: 5,
  "admin-action": 120,
  chat: 10,
  guest: 10,
  login: 20,
  register: 5,
};

export type Counter = (key: string) => Promise<number>;

export async function checkRateLimit({
  ip,
  secret,
  scope,
  increment,
}: {
  ip: string | undefined;
  secret: string | undefined;
  scope: RateLimitScope;
  increment: Counter;
}): Promise<boolean> {
  if (!ip || !secret || secret.length < 32 || ip.length > 128) {
    throw new Error("Rate limiting is not configured");
  }
  const digest = createHmac("sha256", secret).update(ip).digest("hex");
  const count = await increment(`${scope}:${digest}`);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("Invalid rate limit result");
  }
  return count <= LIMITS[scope];
}
