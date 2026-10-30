import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  checkRateLimit,
  LIMITS,
  RATE_LIMIT_SQL,
} from "../../lib/server/security/rate-limit";

const secret = "test-secret-that-is-longer-than-32-bytes";

test("database counters enforce the limit, reset, isolate scopes, and protect IPs", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile("lib/db/migrations/0003_grace_rate_limits.sql", "utf8")
    );
    const increment = async (key: string) => {
      const result = await db.query<{ count: number }>(RATE_LIMIT_SQL, [key]);
      return result.rows[0].count;
    };
    const check = () =>
      checkRateLimit({ increment, ip: "192.0.2.1", scope: "guest", secret });
    const attempts = await Promise.all(
      Array.from({ length: LIMITS.guest + 2 }, () => check())
    );
    assert.equal(attempts.filter(Boolean).length, LIMITS.guest);
    assert.equal(
      await checkRateLimit({
        increment,
        ip: "192.0.2.1",
        scope: "chat",
        secret,
      }),
      true
    );
    const rows = await db.query<{ key: string }>(
      'SELECT "key" FROM "GraceRateLimit"'
    );
    assert.equal(
      rows.rows.some((row) => row.key.includes("192.0.2.1")),
      false
    );
    await db.exec(
      'UPDATE "GraceRateLimit" SET "windowStart" = now() - interval \'2 hours\''
    );
    assert.equal(await check(), true);
    await db.exec(
      'CREATE ROLE rate_limit_anon; GRANT SELECT ON "GraceRateLimit" TO rate_limit_anon; SET ROLE rate_limit_anon'
    );
    assert.equal(
      (await db.query('SELECT * FROM "GraceRateLimit"')).rows.length,
      0
    );
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});

test("missing configuration and failed counters fail closed", async () => {
  const increment = async () => 1;
  await assert.rejects(
    checkRateLimit({ increment, ip: undefined, scope: "chat", secret })
  );
  await assert.rejects(
    checkRateLimit({
      increment,
      ip: "192.0.2.1",
      scope: "chat",
      secret: undefined,
    })
  );
  await assert.rejects(
    checkRateLimit({
      increment,
      ip: "192.0.2.1",
      scope: "chat",
      secret: "short",
    })
  );
  await assert.rejects(
    checkRateLimit({
      increment: () => Promise.reject(new Error("unavailable")),
      ip: "192.0.2.1",
      scope: "chat",
      secret,
    })
  );
  await assert.rejects(
    checkRateLimit({
      increment: async () => 0,
      ip: "192.0.2.1",
      scope: "chat",
      secret,
    })
  );
});
