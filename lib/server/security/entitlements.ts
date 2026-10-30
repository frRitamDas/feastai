export type EntitlementPlan = "free" | "custom";

/** The database clock controls expiry; clients cannot grant their own plan. */
export const EFFECTIVE_ENTITLEMENT_SQL = `
SELECT CASE
  WHEN a."userId" IS NOT NULL THEN 'custom'
  WHEN p."plan" = 'custom' AND (p."planExpiresAt" IS NULL OR p."planExpiresAt" > now()) THEN 'custom'
  ELSE 'free'
END AS "plan", p."planExpiresAt"
FROM "User" u
LEFT JOIN "GraceUserPolicy" p ON p."userId" = u."id"
LEFT JOIN "GraceAdministrator" a ON a."userId" = u."id" AND a."enabled" = true
WHERE u."id" = $1 AND COALESCE(p."enabled", true)`;
