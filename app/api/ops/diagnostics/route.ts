import { createHash, timingSafeEqual } from "node:crypto";
import { ipAddress } from "@vercel/functions";
import postgres from "postgres";
import { resolveDatabaseUrl } from "@/lib/db/connection-url";

async function probe(url: string, forceTls = false) {
  let connection: ReturnType<typeof postgres> | undefined;
  try {
    connection = postgres(url, {
      connect_timeout: 6,
      idle_timeout: 1,
      max: 1,
      ...(forceTls ? { ssl: "require" as const } : {}),
    });
    const [result] = await connection`
      SELECT (SELECT count(*)::int FROM "User") AS users,
             EXISTS(SELECT 1 FROM "GraceSystemSetting" WHERE "id" = 1) AS settings
    `;
    return { reachable: true, ...result };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "unknown";
    return {
      errorCode: /^[A-Z0-9_-]{1,24}$/.test(code) ? code : "unknown",
      reachable: false,
    };
  } finally {
    await connection?.end({ timeout: 1 });
  }
}

// This short-lived release diagnostic is inaccessible unless explicitly enabled
// with a strong, separately generated server-side token. It never returns values.
export async function GET(request: Request) {
  const configured = process.env.GRACE_DIAGNOSTIC_TOKEN;
  const { searchParams } = new URL(request.url);
  const supplied = searchParams.get("token") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (
    !configured ||
    configured.length < 32 ||
    !supplied ||
    !timingSafeEqual(digest(configured), digest(supplied))
  ) {
    return new Response(null, { status: 404 });
  }
  const expectedRef = searchParams.get("ref") ?? "";
  const region = searchParams.get("region") ?? "";
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
        ...(await probe(url)),
      };
      if (process.env.GRACE_SUPABASE_POOLER_HOST) {
        database = {
          ...database,
          effectiveConnection: await probe(
            resolveDatabaseUrl(url, process.env.GRACE_SUPABASE_POOLER_HOST)
          ),
        };
      }
      // Only derive fixed Supabase endpoints for the same project and region;
      // the password is kept server-side and never returned in the result.
      if (
        parsed.hostname === `db.${expectedRef}.supabase.co` &&
        /^[a-z0-9]{20}$/.test(expectedRef) &&
        /^[a-z]{2}-[a-z]+-[0-9]$/.test(region)
      ) {
        const attempts: Record<string, unknown> = {};
        for (const index of [0, 1]) {
          const candidate = new URL(url);
          candidate.hostname = `aws-${index}-${region}.pooler.supabase.com`;
          candidate.port = "5432";
          candidate.username = `${decodeURIComponent(parsed.username)}.${expectedRef}`;
          // biome-ignore lint/performance/noAwaitInLoops: Each connection is independently bounded.
          attempts[`aws-${index}`] = await probe(candidate.toString(), true);
        }
        database = { ...database, poolerAttempts: attempts };
      }
    } catch {
      database = { ...database, errorCode: "INVALID_URL", reachable: false };
    }
  }
  const encryption = process.env.GRACE_ENCRYPTION_KEY ?? "";
  const encryptionKeyFormat = /^[A-Fa-f0-9]{64}$/.test(encryption)
    ? "hex-32"
    : /^[A-Za-z0-9+/]{43}=$/.test(encryption) &&
        Buffer.from(encryption, "base64").length === 32
      ? "base64-32"
      : "other";
  return Response.json(
    {
      authSecretStrong: (process.env.AUTH_SECRET?.length ?? 0) >= 32,
      bootstrapSecretValid:
        (process.env.GRACE_BOOTSTRAP_SECRET?.length ?? 0) >= 32,
      database,
      encryptionKeyFormat,
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
