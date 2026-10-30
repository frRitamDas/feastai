import { ipAddress } from "@vercel/functions";
import { cookies } from "next/headers";
import { z } from "zod";
import { enforceIpRateLimit } from "@/lib/ratelimit";
import { bootstrapAdministrator } from "@/lib/server/admin/bootstrap";
import {
  adminProofVersion,
  audit,
  authorizedAdmin,
  getAdminCatalog,
  getAdminDatabase,
  getAdminIdentity,
} from "@/lib/server/admin/runtime";
import { createAdminProof } from "@/lib/server/admin/session";
import { decodeBase32, verifyTotp } from "@/lib/server/admin/totp";
import { isSameOrigin } from "@/lib/server/conversations/authorization";
import {
  decryptCredential,
  type EncryptedCredential,
  encryptCredential,
  isValidCredentialKey,
} from "@/lib/server/credential-crypto";
import { readLimitedJson } from "@/lib/server/security/read-limited-json";
import { verifyTurnstileChallenge } from "@/lib/server/security/turnstile";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const reply = (value: unknown, status = 200) =>
  Response.json(value, { headers, status });
type Context = { params: Promise<{ action: string }> };
const uuid = z.uuid();
const bodySchema = z
  .object({
    accountId: z
      .string()
      .regex(/^[a-f0-9]{32}$/i)
      .optional(),
    announcementId: uuid.optional(),
    baseUrl: z.url().max(512).optional(),
    body: z.string().trim().min(1).max(2000).optional(),
    challengeToken: z.string().min(1).max(2048).optional(),
    chatEnabled: z.boolean().optional(),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    credential: z.string().min(1).max(8192).optional(),
    enabled: z.boolean().optional(),
    hourlyQuota: z.number().int().min(1).max(1000).optional(),
    keyId: uuid.optional(),
    label: z.string().trim().min(1).max(100).optional(),
    modelId: uuid.optional(),
    name: z.string().trim().min(1).max(300).optional(),
    plan: z.enum(["free", "custom"]).optional(),
    planExpiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
    priority: z.number().int().min(0).max(100).optional(),
    provider: z
      .enum([
        "groq",
        "openrouter",
        "gemini",
        "huggingface",
        "cloudflare",
        "custom",
        "cerebras",
        "sambanova",
        "mistral",
      ])
      .optional(),
    registrationEnabled: z.boolean().optional(),
    role: z.enum(["owner", "operator", "viewer"]).optional(),
    routeId: uuid.optional(),
    strategy: z.enum(["manual", "fastest", "reliable", "balanced"]).optional(),
    title: z.string().trim().min(1).max(120).optional(),
    totpSecret: z.string().min(16).max(128).optional(),
    upstreamId: z.string().trim().min(1).max(300).optional(),
    userId: uuid.optional(),
  })
  .strict();

export async function GET(_request: Request, context: Context) {
  try {
    const admin = await authorizedAdmin();
    if (!admin) {
      return reply({ error: "Not authorized" }, 401);
    }
    if ((await context.params).action !== "overview") {
      return reply({ error: "Not found" }, 404);
    }
    const db = getAdminDatabase();
    const [settings] = await db.query(
      'SELECT "registrationEnabled", "chatEnabled", "updatedAt" FROM "GraceSystemSetting" WHERE "id" = 1'
    );
    if (!settings) {
      return reply({ error: "System settings unavailable" }, 503);
    }
    const [counts] = await db.query(
      'SELECT (SELECT count(*)::int FROM "User" WHERE "isAnonymous" = false) AS users, (SELECT count(*)::int FROM "Chat") AS chats, (SELECT count(*)::int FROM "Message_v2") AS messages'
    );
    const [usage] = await db.query(
      'SELECT count(*)::int AS "completedCalls", sum("inputTokens")::bigint AS "inputTokens", sum("outputTokens")::bigint AS "outputTokens", count(*) FILTER (WHERE "inputTokens" IS NULL OR "outputTokens" IS NULL)::int AS "incompleteReports" FROM "GraceUsageEvent"'
    );
    const usageByModel = await db.query(
      'SELECT "model", "provider", "upstreamModel", count(*)::int AS "completedCalls", sum("inputTokens")::bigint AS "inputTokens", sum("outputTokens")::bigint AS "outputTokens", count(*) FILTER (WHERE "inputTokens" IS NULL OR "outputTokens" IS NULL)::int AS "incompleteReports" FROM "GraceUsageEvent" WHERE "createdAt" >= now() - interval \'30 days\' GROUP BY "model", "provider", "upstreamModel" ORDER BY count(*) DESC LIMIT 50'
    );
    const users = await db.query(
      'SELECT u."id", u."email", u."createdAt", u."isAnonymous", a."role" AS "adminRole", a."enabled" AS "adminEnabled", COALESCE(p."enabled", true) AS "accountEnabled", COALESCE(p."hourlyQuota", 10) AS "hourlyQuota", COALESCE(p."plan", \'free\') AS "plan", p."planExpiresAt" FROM "User" u LEFT JOIN "GraceAdministrator" a ON a."userId" = u."id" LEFT JOIN "GraceUserPolicy" p ON p."userId" = u."id" ORDER BY u."createdAt" DESC LIMIT 100'
    );
    const announcements = await db.query(
      'SELECT "id", "title", "body", "enabled", "createdAt" FROM "GraceAnnouncement" ORDER BY "createdAt" DESC LIMIT 100'
    );
    const logs = await db.query(
      'SELECT "id", "actorId", "action", "target", "outcome", "createdAt" FROM "GraceAdminAudit" ORDER BY "createdAt" DESC LIMIT 100'
    );
    const catalogConfigured =
      process.env.GRACE_CATALOG_ENABLED === "1" &&
      isValidCredentialKey(process.env.GRACE_ENCRYPTION_KEY);
    const [keys, models, routes] = catalogConfigured
      ? await Promise.all([
          getAdminCatalog().listKeys(),
          getAdminCatalog().listCatalog(),
          getAdminCatalog().listRoutes(),
        ])
      : [[], [], []];
    return reply({
      announcements,
      catalogConfigured,
      counts,
      keys,
      logs,
      models,
      role: admin.role,
      routes,
      settings,
      usage,
      usageByModel,
      users,
    });
  } catch {
    return reply({ error: "Administrator service unavailable" }, 503);
  }
}

export async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request.url, request.headers.get("origin"))) {
    return reply({ error: "Invalid origin" }, 403);
  }
  try {
    const { action } = await context.params;
    if (action === "bootstrap") {
      return bootstrapAdministrator(request);
    }
    const identity = await getAdminIdentity();
    if (!identity) {
      return reply({ error: "Not authorized" }, 401);
    }
    const parsed = bodySchema.safeParse(await readLimitedJson(request, 16_384));
    if (!parsed.success) {
      return reply({ error: "Invalid request" }, 400);
    }
    const { data } = parsed;
    if (action === "mfa") {
      await enforceIpRateLimit(ipAddress(request), "admin");
      await enforceIpRateLimit(identity.userId, "admin");
      if (!data.code || !process.env.AUTH_SECRET) {
        return reply({ error: "Invalid verification" }, 400);
      }
      const challengeAccepted = await verifyTurnstileChallenge({
        action: "admin-mfa",
        expectedHost: process.env.AUTH_URL,
        production: process.env.NODE_ENV === "production",
        secret: process.env.GRACE_TURNSTILE_SECRET,
        token: data.challengeToken ?? null,
      });
      if (!challengeAccepted) {
        await audit(identity.userId, "mfa-challenge", null, "denied");
        return reply({ error: "Invalid verification" }, 401);
      }
      const db = getAdminDatabase();
      const accepted = await db.transaction(async (tx) => {
        const [row] = await tx.query<{
          totpSecret: EncryptedCredential;
          lastTotpStep: number;
        }>(
          'SELECT "totpSecret", "lastTotpStep" FROM "GraceAdministrator" WHERE "userId" = $1 AND "enabled" = true FOR UPDATE',
          [identity.userId]
        );
        if (!row) {
          return false;
        }
        const secret = decryptCredential(
          row.totpSecret,
          `admin:${identity.userId}`,
          process.env.GRACE_ENCRYPTION_KEY
        );
        const step = verifyTotp(secret, data.code as string);
        if (step === null || step <= Number(row.lastTotpStep)) {
          await tx.query(
            'INSERT INTO "GraceAdminAudit" ("actorId", "action", "outcome") VALUES ($1, \'mfa\', \'denied\')',
            [identity.userId]
          );
          return false;
        }
        await tx.query(
          'UPDATE "GraceAdministrator" SET "lastTotpStep" = $2 WHERE "userId" = $1',
          [identity.userId, step]
        );
        await tx.query(
          'INSERT INTO "GraceAdminAudit" ("actorId", "action", "outcome") VALUES ($1, \'mfa\', \'success\')',
          [identity.userId]
        );
        return true;
      });
      if (!accepted) {
        return reply({ error: "Invalid verification" }, 401);
      }
      const proofVersion = await adminProofVersion(identity);
      if (!proofVersion) {
        return reply({ error: "Invalid session" }, 401);
      }
      (await cookies()).set(
        "grace_admin_proof",
        createAdminProof(
          identity.userId,
          process.env.AUTH_SECRET,
          proofVersion
        ),
        {
          httpOnly: true,
          maxAge: 600,
          path: "/",
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
        }
      );
      return reply({ ok: true });
    }
    const admin = await authorizedAdmin();
    if (!admin || admin.role === "viewer") {
      return reply({ error: "Not authorized" }, 403);
    }
    await enforceIpRateLimit(admin.userId, "admin-action");
    const target =
      data.announcementId ??
      data.userId ??
      data.keyId ??
      data.routeId ??
      data.modelId ??
      data.provider ??
      null;
    // Audit the attempt before any mutation or upstream request.
    await audit(admin.userId, action.slice(0, 64), target, "attempt");
    let result: unknown = { ok: true };
    if (action === "set-administrator" || action === "disable-administrator") {
      if (
        admin.role !== "owner" ||
        !data.userId ||
        data.userId === admin.userId
      ) {
        return reply({ error: "Not authorized" }, 403);
      }
      if (action === "set-administrator") {
        if (!(data.role && data.totpSecret)) {
          return reply({ error: "Invalid request" }, 400);
        }
        decodeBase32(data.totpSecret);
        const encrypted = encryptCredential(
          data.totpSecret,
          `admin:${data.userId}`,
          process.env.GRACE_ENCRYPTION_KEY
        );
        const rows = await getAdminDatabase().transaction(async (tx) => {
          await tx.query('SELECT "id" FROM "User" WHERE "id" = $1 FOR UPDATE', [
            data.userId,
          ]);
          return tx.query(
            `INSERT INTO "GraceAdministrator" ("userId", "role", "totpSecret")
           SELECT u."id", $2, $3::text::jsonb FROM "User" u LEFT JOIN "GraceUserPolicy" p ON p."userId" = u."id" WHERE u."id" = $1 AND u."isAnonymous" = false AND COALESCE(p."enabled", true)
           ON CONFLICT ("userId") DO UPDATE SET "role" = EXCLUDED."role", "totpSecret" = EXCLUDED."totpSecret", "enabled" = true, "lastTotpStep" = -1, "updatedAt" = now()
           RETURNING "userId"`,
            [data.userId, data.role, JSON.stringify(encrypted)]
          );
        });
        if (!rows.length) {
          return reply({ error: "Account not found" }, 404);
        }
      } else {
        const rows = await getAdminDatabase().query(
          'UPDATE "GraceAdministrator" SET "enabled" = false, "updatedAt" = now() WHERE "userId" = $1 RETURNING "userId"',
          [data.userId]
        );
        if (!rows.length) {
          return reply({ error: "Administrator not found" }, 404);
        }
      }
      await audit(admin.userId, action, data.userId, "success");
      return reply({ ok: true });
    }
    if (action === "set-user-policy") {
      if (
        admin.role !== "owner" ||
        !data.userId ||
        data.userId === admin.userId
      ) {
        return reply({ error: "Not authorized" }, 403);
      }
      if (
        data.enabled === undefined ||
        data.hourlyQuota === undefined ||
        !data.plan
      ) {
        return reply({ error: "Invalid request" }, 400);
      }
      const rows = await getAdminDatabase().transaction(async (tx) => {
        await tx.query('SELECT "id" FROM "User" WHERE "id" = $1 FOR UPDATE', [
          data.userId,
        ]);
        const updated = await tx.query(
          `INSERT INTO "GraceUserPolicy" ("userId", "enabled", "hourlyQuota", "plan", "planExpiresAt")
         SELECT u."id", $2, $3, $4, $5::timestamptz FROM "User" u
         WHERE u."id" = $1 AND NOT EXISTS
           (SELECT 1 FROM "GraceAdministrator" a WHERE a."userId" = u."id" AND a."enabled" = true)
         ON CONFLICT ("userId") DO UPDATE SET "enabled" = EXCLUDED."enabled", "hourlyQuota" = EXCLUDED."hourlyQuota", "plan" = EXCLUDED."plan", "planExpiresAt" = EXCLUDED."planExpiresAt", "updatedAt" = now()
         RETURNING "userId"`,
          [
            data.userId,
            data.enabled,
            data.hourlyQuota,
            data.plan,
            data.plan === "custom" ? (data.planExpiresAt ?? null) : null,
          ]
        );
        if (updated.length && !data.enabled) {
          await tx.query(
            'UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1 WHERE "id" = $1',
            [data.userId]
          );
        }
        return updated;
      });
      if (!rows.length) {
        return reply(
          { error: "Account not found or is an active administrator" },
          400
        );
      }
      await audit(admin.userId, action, data.userId, "success");
      return reply({ ok: true });
    }
    if (action === "system-settings") {
      if (admin.role !== "owner") {
        return reply({ error: "Not authorized" }, 403);
      }
      if (
        data.chatEnabled === undefined ||
        data.registrationEnabled === undefined
      ) {
        return reply({ error: "Invalid request" }, 400);
      }
      const rows = await getAdminDatabase().query(
        'UPDATE "GraceSystemSetting" SET "chatEnabled" = $1, "registrationEnabled" = $2, "updatedAt" = now() WHERE "id" = 1 RETURNING "id"',
        [data.chatEnabled, data.registrationEnabled]
      );
      if (!rows.length) {
        return reply({ error: "System settings unavailable" }, 503);
      }
      await audit(admin.userId, action, null, "success");
      return reply({ ok: true });
    }
    if (action === "create-announcement") {
      if (!(data.title && data.body)) {
        return reply({ error: "Invalid request" }, 400);
      }
      const [created] = await getAdminDatabase().query<{ id: string }>(
        'INSERT INTO "GraceAnnouncement" ("title", "body") VALUES ($1, $2) RETURNING "id"',
        [data.title, data.body]
      );
      await audit(admin.userId, action, created.id, "success");
      return reply({ id: created.id });
    }
    if (action === "set-announcement") {
      if (!data.announcementId || data.enabled === undefined) {
        return reply({ error: "Invalid request" }, 400);
      }
      const rows = await getAdminDatabase().query(
        'UPDATE "GraceAnnouncement" SET "enabled" = $2, "updatedAt" = now() WHERE "id" = $1 RETURNING "id"',
        [data.announcementId, data.enabled]
      );
      if (!rows.length) {
        return reply({ error: "Announcement not found" }, 404);
      }
      await audit(admin.userId, action, data.announcementId, "success");
      return reply({ ok: true });
    }
    const store = getAdminCatalog();
    switch (action) {
      case "add-key":
        if (
          !(data.provider && data.label && data.credential) ||
          (data.provider === "cloudflare" && !data.accountId) ||
          (data.provider === "custom" && !data.baseUrl)
        ) {
          return reply({ error: "Invalid request" }, 400);
        }
        result = {
          id: await store.addKey({
            credential:
              data.provider === "cloudflare"
                ? JSON.stringify({
                    accountId: data.accountId,
                    apiToken: data.credential,
                  })
                : data.provider === "custom"
                  ? JSON.stringify({
                      apiKey: data.credential,
                      baseUrl: data.baseUrl,
                    })
                  : data.credential,
            label: data.label,
            provider: data.provider,
          }),
        };
        break;
      case "discover":
        if (!data.keyId) {
          return reply({ error: "Invalid request" }, 400);
        }
        result = await store.discover(data.keyId);
        break;
      case "verify":
        if (!(data.keyId && data.modelId)) {
          return reply({ error: "Invalid request" }, 400);
        }
        result = { verified: await store.verify(data.keyId, data.modelId) };
        break;
      case "key-enabled":
        if (!data.keyId || data.enabled === undefined) {
          return reply({ error: "Invalid request" }, 400);
        }
        await store.setKeyEnabled(data.keyId, data.enabled);
        break;
      case "model-enabled":
        if (!data.modelId || data.enabled === undefined) {
          return reply({ error: "Invalid request" }, 400);
        }
        await store.setModelEnabled(data.modelId, data.enabled);
        break;
      case "model-plan":
        if (admin.role !== "owner") {
          return reply({ error: "Not authorized" }, 403);
        }
        if (!(data.modelId && data.plan)) {
          return reply({ error: "Invalid request" }, 400);
        }
        await store.setModelPlan(data.modelId, data.plan);
        break;
      case "model-vision":
        if (!data.modelId || data.enabled === undefined) {
          return reply({ error: "Invalid request" }, 400);
        }
        await store.setModelVision(data.modelId, data.enabled);
        break;
      case "permission":
        if (!(data.keyId && data.modelId) || data.enabled === undefined) {
          return reply({ error: "Invalid request" }, 400);
        }
        await store.setPermission(data.keyId, data.modelId, data.enabled);
        break;
      case "route-create":
        if (!data.name || data.name.length > 100) {
          return reply({ error: "Invalid request" }, 400);
        }
        result = { id: await store.createRoute(data.name) };
        break;
      case "route-enabled":
        if (!data.routeId || data.enabled === undefined) {
          return reply({ error: "Invalid request" }, 400);
        }
        await store.setRouteEnabled(data.routeId, data.enabled);
        break;
      case "route-plan":
        if (admin.role !== "owner") {
          return reply({ error: "Not authorized" }, 403);
        }
        if (!(data.routeId && data.plan)) {
          return reply({ error: "Invalid request" }, 400);
        }
        await store.setRoutePlan(data.routeId, data.plan);
        break;
      case "route-strategy":
        if (!(data.routeId && data.strategy)) {
          return reply({ error: "Invalid request" }, 400);
        }
        await store.setRouteStrategy(data.routeId, data.strategy);
        break;
      case "route-member":
        if (!(data.routeId && data.modelId) || data.priority === undefined) {
          return reply({ error: "Invalid request" }, 400);
        }
        await store.setRouteMember(data.routeId, data.modelId, data.priority);
        break;
      case "route-remove":
        if (!(data.routeId && data.modelId)) {
          return reply({ error: "Invalid request" }, 400);
        }
        await store.removeRouteMember(data.routeId, data.modelId);
        break;
      case "key-priority":
        if (!data.keyId || data.priority === undefined) {
          return reply({ error: "Invalid request" }, 400);
        }
        await store.setKeyPriority(data.keyId, data.priority);
        break;
      case "register-model":
        if (!(data.keyId && data.upstreamId && data.name)) {
          return reply({ error: "Invalid request" }, 400);
        }
        result = {
          id: await store.registerModel(data.keyId, data.upstreamId, data.name),
        };
        break;
      case "delete-key":
        if (!data.keyId || admin.role !== "owner") {
          return reply({ error: "Not authorized" }, 403);
        }
        await store.deleteKey(data.keyId);
        break;
      default:
        return reply({ error: "Not found" }, 404);
    }
    await audit(admin.userId, action, target, "success");
    return reply(result);
  } catch {
    return reply({ error: "Administrator action failed" }, 503);
  }
}
