import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { ipAddress } from "@vercel/functions";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { enforceIpRateLimit } from "@/lib/ratelimit";
import { encryptCredential } from "@/lib/server/credential-crypto";
import { readLimitedJson } from "@/lib/server/security/read-limited-json";
import { verifyTurnstileChallenge } from "@/lib/server/security/turnstile";
import { getAdminDatabase } from "./runtime";
import { verifyTotp } from "./totp";

const schema = z
  .object({
    bootstrapSecret: z.string().min(1).max(256),
    challengeToken: z.string().min(1).max(2048).optional(),
    code: z.string().regex(/^\d{6}$/),
    totpSecret: z.string().regex(/^[A-Z2-7]{32}$/),
  })
  .strict();
const headers = { "Cache-Control": "private, no-store" };
const reply = (message: string, status: number) =>
  Response.json({ error: message }, { headers, status });

/** First-owner setup is opt-in, single-use, authenticated and serialized. */
export async function bootstrapAdministrator(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.type !== "regular") {
    return reply("Sign in with a regular account first.", 401);
  }
  const expected = process.env.GRACE_BOOTSTRAP_SECRET;
  if (!expected || expected.length < 32 || expected.length > 256) {
    return reply("Administrator setup is unavailable.", 503);
  }
  try {
    await enforceIpRateLimit(ipAddress(request), "admin");
    await enforceIpRateLimit(session.user.id, "admin");
    const parsed = schema.safeParse(await readLimitedJson(request, 4096));
    if (!parsed.success) {
      return reply("Invalid setup request.", 400);
    }
    const suppliedHash = createHash("sha256")
      .update(parsed.data.bootstrapSecret)
      .digest();
    const expectedHash = createHash("sha256").update(expected).digest();
    if (!timingSafeEqual(suppliedHash, expectedHash)) {
      return reply("Invalid setup verification.", 403);
    }
    const challengeAccepted = await verifyTurnstileChallenge({
      action: "admin-bootstrap",
      expectedHost: process.env.AUTH_URL,
      production: process.env.NODE_ENV === "production",
      secret: process.env.GRACE_TURNSTILE_SECRET,
      token: parsed.data.challengeToken ?? null,
    });
    const step = verifyTotp(parsed.data.totpSecret, parsed.data.code);
    if (!challengeAccepted || step === null) {
      return reply("Invalid setup verification.", 403);
    }
    const envelope = encryptCredential(
      parsed.data.totpSecret,
      `admin:${session.user.id}`,
      process.env.GRACE_ENCRYPTION_KEY
    );
    const created = await getAdminDatabase().transaction(async (tx) => {
      // Shared with the operator CLI; a disabled owner also prevents rebootstrap.
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtext('grace.admin.bootstrap'))"
      );
      const owners = await tx.query(
        'SELECT "userId" FROM "GraceAdministrator" WHERE "role" = \'owner\' LIMIT 1'
      );
      if (owners.length) {
        return false;
      }
      const users = await tx.query(
        'SELECT u."id" FROM "User" u LEFT JOIN "GraceUserPolicy" p ON p."userId" = u."id" WHERE u."id" = $1 AND u."isAnonymous" = false AND COALESCE(p."enabled", true) FOR UPDATE OF u',
        [session.user.id]
      );
      if (!users.length) {
        return false;
      }
      await tx.query(
        'INSERT INTO "GraceAdministrator" ("userId", "role", "totpSecret", "lastTotpStep") VALUES ($1, \'owner\', $2::text::jsonb, $3)',
        [session.user.id, JSON.stringify(envelope), step]
      );
      await tx.query(
        'INSERT INTO "GraceAdminAudit" ("actorId", "action", "target", "outcome") VALUES ($1::uuid, \'bootstrap\', $1::uuid::text, \'success\')',
        [session.user.id]
      );
      return true;
    });
    if (!created) {
      return reply("Administrator setup is no longer available.", 409);
    }
    return Response.json({ ok: true }, { headers });
  } catch {
    return reply("Administrator setup is unavailable.", 503);
  }
}
