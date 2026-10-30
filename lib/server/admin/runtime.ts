import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { auth } from "@/app/(auth)/auth";
import { createCatalogDatabase } from "@/lib/server/catalog/postgres";
import { type CatalogDatabase, CatalogStore } from "@/lib/server/catalog/store";
import { verifyAdminProof } from "./session";

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
    !process.env.GRACE_ENCRYPTION_KEY ||
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
/** Bind the short-lived proof to the current Auth.js session cookie. */
export async function adminProofVersion(
  admin: Administrator
): Promise<string | null> {
  const jar = await cookies();
  const pieces = jar
    .getAll()
    .filter((cookie) =>
      /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/.test(cookie.name)
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!pieces.length) {
    return null;
  }
  const binding = createHash("sha256")
    .update(pieces.map((piece) => `${piece.name}=${piece.value}`).join(";"))
    .digest("base64url");
  return `${new Date(admin.updatedAt).toISOString()}:${binding}`;
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
