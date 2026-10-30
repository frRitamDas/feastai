import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { RESERVE_QUOTA_SQL } from "../../lib/server/security/quota";

test("account policies enforce concurrent quotas, resets, isolation and disabled users", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile("lib/db/migrations/0000_initial.sql", "utf8"));
    await db.exec(
      await readFile(
        "lib/db/migrations/0013_grace_account_policies.sql",
        "utf8"
      )
    );
    const a = "00000000-0000-4000-8000-000000000001";
    const b = "00000000-0000-4000-8000-000000000002";
    await db.query(
      'INSERT INTO "User" ("id", "email") VALUES ($1, $2), ($3, $4)',
      [a, "a@example.com", b, "b@example.com"]
    );
    await db.query(
      'INSERT INTO "GraceUserPolicy" ("userId", "hourlyQuota", "plan") VALUES ($1, 3, \'custom\')',
      [a]
    );
    const results = await Promise.all(
      Array.from({ length: 12 }, () => db.query(RESERVE_QUOTA_SQL, [a]))
    );
    assert.equal(
      results.filter((result) => result.rows.length === 1).length,
      3
    );
    assert.equal((await db.query(RESERVE_QUOTA_SQL, [b])).rows.length, 1);
    await db.query(
      'UPDATE "GraceQuotaCounter" SET "windowStart" = now() - interval \'2 hours\' WHERE "userId" = $1',
      [a]
    );
    assert.equal((await db.query(RESERVE_QUOTA_SQL, [a])).rows.length, 1);
    await db.query(
      'UPDATE "GraceUserPolicy" SET "enabled" = false WHERE "userId" = $1',
      [a]
    );
    assert.equal((await db.query(RESERVE_QUOTA_SQL, [a])).rows.length, 0);
    await db.exec(
      'CREATE ROLE quota_anon; GRANT SELECT ON "GraceUserPolicy", "GraceQuotaCounter" TO quota_anon; SET ROLE quota_anon'
    );
    assert.equal(
      (await db.query('SELECT * FROM "GraceUserPolicy"')).rows.length,
      0
    );
    assert.equal(
      (await db.query('SELECT * FROM "GraceQuotaCounter"')).rows.length,
      0
    );
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});
