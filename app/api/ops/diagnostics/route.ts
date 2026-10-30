import { createHash, timingSafeEqual } from "node:crypto";
import { ipAddress } from "@vercel/functions";
import postgres from "postgres";

// This short-lived release diagnostic is inaccessible unless explicitly enabled
// with a strong, separately generated server-side token. It never returns values.
export async function GET(request: Request) {
  const configured = process.env.GRACE_DIAGNOSTIC_TOKEN;
  const supplied = new URL(request.url).searchParams.get("token") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (
    !configured ||
    configured.length < 32 ||
    !supplied ||
    !timingSafeEqual(digest(configured), digest(supplied))
  ) {
    return new Response(null, { status: 404 });
  }
  const expectedRef = new URL(request.url).searchParams.get("ref") ?? "";
  const url = process.env.POSTGRES_URL;
  let database: Record<string, unknown> = { configured: Boolean(url) };
  if (url) {
    try {
      const parsed = new URL(url);
      database = {
        ...database,
        pooler: parsed.hostname.endsWith(".pooler.supabase.com"),
        targetMatches:
          /^[a-z0-9]{20}$/.test(expectedRef) &&
          (parsed.hostname.includes(expectedRef) ||
            decodeURIComponent(parsed.username).includes(expectedRef)),
      };
      const connection = postgres(url, {
        connect_timeout: 6,
        idle_timeout: 1,
        max: 1,
      });
      try {
        const [result] = await connection`
          SELECT (SELECT count(*)::int FROM "User") AS users,
                 EXISTS(SELECT 1 FROM "GraceSystemSetting" WHERE "id" = 1) AS settings
        `;
        database = { ...database, reachable: true, ...result };
      } finally {
        await connection.end({ timeout: 1 });
      }
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "unknown";
      database = {
        ...database,
        errorCode: /^[A-Z0-9_-]{1,24}$/.test(code) ? code : "unknown",
        reachable: false,
      };
    }
  }
  return Response.json(
    {
      authSecretStrong: (process.env.AUTH_SECRET?.length ?? 0) >= 32,
      bootstrapSecretValid:
        (process.env.GRACE_BOOTSTRAP_SECRET?.length ?? 0) >= 32,
      database,
      encryptionKeyValid:
        Buffer.from(process.env.GRACE_ENCRYPTION_KEY ?? "", "base64").length ===
        32,
      requestIpPresent: Boolean(ipAddress(request)),
      turnstileSecretPresent: Boolean(process.env.GRACE_TURNSTILE_SECRET),
      turnstileSiteKeyPresent: Boolean(
        process.env.NEXT_PUBLIC_GRACE_TURNSTILE_SITE_KEY
      ),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    }
  );
}
