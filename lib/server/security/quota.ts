/** Atomically reserve one generation request per user in a rolling fixed window. */
export const RESERVE_QUOTA_SQL = `
INSERT INTO "GraceQuotaCounter" ("userId", "windowStart", "count")
SELECT u."id", now(), 1 FROM "User" u
LEFT JOIN "GraceUserPolicy" p ON p."userId" = u."id"
WHERE u."id" = $1 AND COALESCE(p."enabled", true)
ON CONFLICT ("userId") DO UPDATE SET
  "windowStart" = CASE WHEN "GraceQuotaCounter"."windowStart" <= now() - interval '1 hour'
    THEN now() ELSE "GraceQuotaCounter"."windowStart" END,
  "count" = CASE WHEN "GraceQuotaCounter"."windowStart" <= now() - interval '1 hour'
    THEN 1 ELSE "GraceQuotaCounter"."count" + 1 END
WHERE "GraceQuotaCounter"."windowStart" <= now() - interval '1 hour'
  OR "GraceQuotaCounter"."count" < COALESCE((SELECT "hourlyQuota" FROM "GraceUserPolicy" WHERE "userId" = $1), 10)
RETURNING "count"`;
