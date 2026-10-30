import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("usage preserves unknown token counts and survives chat deletion without exposing rows", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile("lib/db/migrations/0000_initial.sql", "utf8"));
    await db.exec(
      await readFile("lib/db/migrations/0008_grace_usage_events.sql", "utf8")
    );
    await db.exec(
      `INSERT INTO "User" ("id", "email") VALUES ('11111111-1111-4111-8111-111111111111','test@example.test'); INSERT INTO "Chat" ("id", "createdAt", "title", "userId") VALUES ('22222222-2222-4222-8222-222222222222', now(), 'Test', '11111111-1111-4111-8111-111111111111'); INSERT INTO "GraceUsageEvent" ("callId", "userId", "chatId", "model", "inputTokens") VALUES ('call', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'model', 12);`
    );
    const before = await db.query<{
      inputTokens: number;
      outputTokens: number | null;
    }>('SELECT "inputTokens", "outputTokens" FROM "GraceUsageEvent"');
    assert.deepEqual(before.rows[0], { inputTokens: 12, outputTokens: null });
    await db.exec(
      'DELETE FROM "Chat" WHERE "id" = \'22222222-2222-4222-8222-222222222222\''
    );
    assert.equal(
      (
        await db.query<{ chatId: string | null }>(
          'SELECT "chatId" FROM "GraceUsageEvent"'
        )
      ).rows[0].chatId,
      null
    );
    await db.exec(
      'CREATE ROLE usage_test_anon; GRANT SELECT ON "GraceUsageEvent" TO usage_test_anon; SET ROLE usage_test_anon'
    );
    assert.equal(
      (await db.query('SELECT * FROM "GraceUsageEvent"')).rows.length,
      0
    );
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});
