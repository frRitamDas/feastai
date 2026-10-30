import { config } from "dotenv";
import { decodeBase32 } from "../lib/server/admin/totp";
import { createCatalogDatabase } from "../lib/server/catalog/postgres";
import { encryptCredential } from "../lib/server/credential-crypto";

config({ path: ".env.local", quiet: true });
async function main() {
  const [command, userId] = process.argv.slice(2);
  const secret = process.env.GRACE_ADMIN_TOTP_SECRET;
  if (
    command !== "provision" ||
    !userId ||
    !/^[0-9a-f-]{36}$/i.test(userId) ||
    !secret
  ) {
    throw new Error("Invalid parameters");
  }
  decodeBase32(secret);
  const encrypted = encryptCredential(
    secret,
    `admin:${userId}`,
    process.env.GRACE_ENCRYPTION_KEY
  );
  const { database, close } = createCatalogDatabase(
    process.env.POSTGRES_URL ?? ""
  );
  try {
    await database.transaction(async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtext('grace.admin.bootstrap'))"
      );
      const users = await tx.query(
        'SELECT "id" FROM "User" WHERE "id" = $1 AND "isAnonymous" = false FOR UPDATE',
        [userId]
      );
      if (!users.length) {
        throw new Error("User not found");
      }
      const existing = await tx.query(
        'SELECT "userId" FROM "GraceAdministrator" WHERE "role" = \'owner\''
      );
      if (existing.length) {
        throw new Error("Owner already provisioned");
      }
      await tx.query(
        'INSERT INTO "GraceAdministrator" ("userId", "role", "totpSecret") VALUES ($1, \'owner\', $2::jsonb)',
        [userId, JSON.stringify(encrypted)]
      );
      await tx.query(
        'INSERT INTO "GraceAdminAudit" ("actorId", "action", "target", "outcome") VALUES ($1, \'bootstrap\', $1::text, \'success\')',
        [userId]
      );
    });
    console.log(
      "Administrator provisioned. Enroll the provided TOTP secret in your authenticator."
    );
  } finally {
    await close();
  }
}
main().catch(() => {
  console.error(
    "Provisioning failed. Verify configuration and inputs on the trusted host."
  );
  process.exitCode = 1;
});
