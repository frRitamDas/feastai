import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  createAdminProof,
  verifyAdminProof,
} from "../../lib/server/admin/session";
import {
  decodeBase32,
  totpCode,
  verifyTotp,
} from "../../lib/server/admin/totp";

const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
test("TOTP follows RFC 6238 vectors and rejects invalid codes", () => {
  assert.equal(totpCode(secret, 1), "287082");
  assert.equal(verifyTotp(secret, "287082", 59_000), 1);
  assert.equal(verifyTotp(secret, "287082", 150_000), null);
  assert.equal(verifyTotp(secret, "not-code", 59_000), null);
  assert.throws(() => decodeBase32("bad!"));
});

test("administrator proof is bound to user, membership version and expiry", () => {
  const signingKey = "a-strong-test-secret-with-32-characters";
  const proof = createAdminProof("user-a", signingKey, "v1", 1_000_000);
  assert.equal(
    verifyAdminProof(proof, "user-a", signingKey, "v1", 1_000_000),
    true
  );
  assert.equal(
    verifyAdminProof(proof, "user-b", signingKey, "v1", 1_000_000),
    false
  );
  assert.equal(
    verifyAdminProof(proof, "user-a", signingKey, "v2", 1_000_000),
    false
  );
  assert.equal(
    verifyAdminProof(`${proof}x`, "user-a", signingKey, "v1", 1_000_000),
    false
  );
  assert.equal(
    verifyAdminProof(proof, "user-a", signingKey, "v1", 1_600_000),
    false
  );
});

test("administrator tables deny unprivileged database roles", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile("lib/db/migrations/0000_initial.sql", "utf8"));
    await db.exec(
      await readFile("lib/db/migrations/0005_grace_administration.sql", "utf8")
    );
    await db.exec(
      `INSERT INTO "User" ("id", "email") VALUES ('11111111-1111-4111-8111-111111111111', 'admin@example.test'); INSERT INTO "GraceAdministrator" ("userId", "role", "totpSecret") VALUES ('11111111-1111-4111-8111-111111111111', 'owner', '{}'); INSERT INTO "GraceAdminAudit" ("actorId", "action", "outcome") VALUES ('11111111-1111-4111-8111-111111111111', 'test', 'success');`
    );
    await db.exec(
      'CREATE ROLE untrusted_admin_test; GRANT SELECT ON "GraceAdministrator", "GraceAdminAudit" TO untrusted_admin_test; SET ROLE untrusted_admin_test'
    );
    assert.equal(
      (await db.query('SELECT * FROM "GraceAdministrator"')).rows.length,
      0
    );
    assert.equal(
      (await db.query('SELECT * FROM "GraceAdminAudit"')).rows.length,
      0
    );
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});
