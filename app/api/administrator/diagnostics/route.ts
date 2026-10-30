import { createHash, timingSafeEqual } from "node:crypto";
import { ipAddress } from "@vercel/functions";
import { headers } from "next/headers";
import { getEffectiveEntitlement, getSystemSettings } from "@/lib/db/queries";
import { getAdminDatabase } from "@/lib/server/admin/runtime";
import { getRuntimeCatalog } from "@/lib/server/catalog/runtime";
import { isValidCredentialKey } from "@/lib/server/credential-crypto";

function safeCode(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "unknown";
  return /^[A-Z0-9_-]{1,64}$/.test(code) ? code : "unknown";
}

async function catalogStatus() {
  let stage = "configuration";
  try {
    const catalog = getRuntimeCatalog();
    if (!catalog) {
      return { enabled: false };
    }
    stage = "queries";
    const [models, routes] = await Promise.all([
      catalog.listPublicModels("free"),
      catalog.listPublicRoutes("free"),
    ]);
    return {
      enabled: true,
      modelCount: models.length,
      ready: true,
      routeCount: routes.length,
    };
  } catch (error) {
    return { errorCode: safeCode(error), ready: false, stage };
  }
}

async function databaseStatus() {
  let stage = "settings";
  try {
    await getSystemSettings();
    stage = "guest lookup";
    const rows = await getAdminDatabase().query<{ id: string }>(
      'SELECT "id" FROM "User" WHERE "isAnonymous" = true LIMIT 1'
    );
    if (rows.length) {
      stage = "entitlement";
      await getEffectiveEntitlement(rows[0].id);
    }
    return { ready: true };
  } catch (error) {
    return { errorCode: safeCode(error), ready: false, stage };
  }
}

async function turnstileStatus() {
  if (!process.env.GRACE_TURNSTILE_SECRET) {
    return { configured: false };
  }
  try {
    // Deliberately invalid: checks service reachability and server-key format,
    // but can never satisfy a registration or mint a verification token.
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        body: new URLSearchParams({
          response: "invalid-diagnostic-token",
          secret: process.env.GRACE_TURNSTILE_SECRET,
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(7000),
      }
    );
    const body = (await response.json()) as { "error-codes"?: unknown };
    const codes = Array.isArray(body["error-codes"])
      ? body["error-codes"].filter(
          (code: unknown) =>
            typeof code === "string" && /^[a-z-]{1,64}$/.test(code)
        )
      : [];
    return { codes, reachable: response.ok };
  } catch (error) {
    return { errorCode: safeCode(error), reachable: false };
  }
}

// Short-lived, guarded release diagnostic. It never returns credentials, user
// identifiers or raw error messages and is removed once the failure is resolved.
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
  const requestHeaders = await headers();
  const [catalog, database, turnstile] = await Promise.all([
    catalogStatus(),
    databaseStatus(),
    turnstileStatus(),
  ]);
  return Response.json(
    {
      authSecretStrong: (process.env.AUTH_SECRET?.length ?? 0) >= 32,
      catalog,
      database,
      encryptionKeyValid: isValidCredentialKey(
        process.env.GRACE_ENCRYPTION_KEY
      ),
      ipPresent: Boolean(ipAddress(request)),
      serverActionIpPresent: Boolean(ipAddress({ headers: requestHeaders })),
      turnstile,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    }
  );
}
