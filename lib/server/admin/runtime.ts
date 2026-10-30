import "server-only";
import { cookies, headers } from "next/headers";
import { getToken } from "next-auth/jwt";
import { auth } from "@/app/(auth)/auth";
import { createCatalogDatabase } from "@/lib/server/catalog/postgres";
import { type CatalogDatabase, CatalogStore } from "@/lib/server/catalog/store";
import { isValidCredentialKey } from "@/lib/server/credential-crypto";
import { verifyAdminProof } from "./session";
import { sessionBinding } from "./session-binding";

export type AdminRole = "owner" | "operator" | "viewer";
export type Administrator = {
  userId: string;
  role: AdminRole;
  updatedAt: Date;
};
let database: CatalogDatabase | undefined;
export function getAdminDatabase(): CatalogDatabase {
  if (!process.env.POSTGRES_URL) {
    throw new Error("Database unavailable");
  }
  database ??= createCatalogDatabase(process.env.POSTGRES_URL).database;
  return database;
}
export function getAdminCatalog(): CatalogStore {
  if (
    !isValidCredentialKey(process.env.GRACE_ENCRYPTION_KEY) ||
    process.env.GRACE_CATALOG_ENABLED !== "1"
  ) {
    throw new Error("Catalog unavailable");
  }
  return new CatalogStore(getAdminDatabase(), process.env.GRACE_ENCRYPTION_KEY);
}
export async function getAdminIdentity(): Promise<Administrator | null> {
  const session = await auth();
  if (!session?.user?.id || session.user.type !== "regular") {
    return null;
  }
  const [record] = await getAdminDatabase().query<Administrator>(
    'SELECT "userId", "role", "updatedAt" FROM "GraceAdministrator" WHERE "userId" = $1 AND "enabled" = true',
    [session.user.id]
  );
  if (!record || !["owner", "operator", "viewer"].includes(record.role)) {
    return null;
  }
  return record;
}
/** Bind the proof to the authenticated login, not its rotating JWT ciphertext. */
export async function adminProofVersion(
  admin: Administrator
): Promise<string | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    return null;
  }
  const requestHeaders = await headers();
  const authUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  let secure: boolean;
  try {
    // Match Auth.js' default cookie selection, even if both cookie names are
    // present, so a different login cannot be substituted for the checked one.
    secure = authUrl
      ? new URL(authUrl).protocol === "https:"
      : (requestHeaders.get("x-forwarded-proto") ?? "https").replace(
          /:$/,
          ""
        ) === "https";
  } catch {
    return null;
  }
  const cookieName = secure
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
  // Do not accept the Authorization-header fallback that getToken supports:
  // the proof must be tied to the same browser cookie checked by auth().
  const cookieHeader = requestHeaders.get("cookie") ?? "";
  const token = await getToken({
    cookieName,
    req: { headers: new Headers({ cookie: cookieHeader }) },
    secret,
    secureCookie: secure,
  });
  if (!token || token.id !== admin.userId || token.type !== "regular") {
    return null;
  }
  const binding = sessionBinding(token);
  return binding
    ? `${new Date(admin.updatedAt).toISOString()}:${binding}`
    : null;
}
export async function authorizedAdmin(): Promise<Administrator | null> {
  const admin = await getAdminIdentity();
  if (!admin) {
    return null;
  }
  const proof = (await cookies()).get("grace_admin_proof")?.value;
  const version = await adminProofVersion(admin);
  return version &&
    verifyAdminProof(proof, admin.userId, process.env.AUTH_SECRET, version)
    ? admin
    : null;
}
export async function audit(
  actor: string,
  action: string,
  target: string | null,
  outcome: string
) {
  await getAdminDatabase().query(
    'INSERT INTO "GraceAdminAudit" ("actorId", "action", "target", "outcome") VALUES ($1, $2, $3, $4)',
    [actor, action, target, outcome]
  );
}
