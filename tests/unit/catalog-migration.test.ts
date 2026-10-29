import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("catalog migration preserves chat data and denies public roles", async () => {
  const db = new PGlite();
  try {
    const initial = await readFile(
      "lib/db/migrations/0000_initial.sql",
      "utf8"
    );
    const catalog = await readFile(
      "lib/db/migrations/0001_grace_provider_catalog.sql",
      "utf8"
    );
    await db.exec(initial);
    await db.exec(`INSERT INTO "User" ("id", "email") VALUES ('11111111-1111-4111-8111-111111111111', 'example@example.test');
      INSERT INTO "Chat" ("id", "createdAt", "title", "userId") VALUES ('22222222-2222-4222-8222-222222222222', now(), 'Existing chat', '11111111-1111-4111-8111-111111111111');`);
    await db.exec(catalog);
    const privateTables = await readFile(
      "lib/db/migrations/0002_grace_private_app_tables.sql",
      "utf8"
    );
    await db.exec(privateTables);
    const existing = await db.query<{ title: string }>(
      'SELECT "title" FROM "Chat"'
    );
    assert.equal(existing.rows[0].title, "Existing chat");
    await db.exec(`INSERT INTO "GraceProviderKey" ("id", "provider", "label", "encryptedCredential") VALUES ('33333333-3333-4333-8333-333333333333', 'groq', 'test', '{}');
      INSERT INTO "GraceModel" ("id", "provider", "upstreamId", "name") VALUES ('44444444-4444-4444-8444-444444444444', 'mistral', 'test', 'Test');`);
    await assert.rejects(
      db.exec(
        `INSERT INTO "GraceKeyModel" ("keyId", "modelId", "provider") VALUES ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', 'groq')`
      )
    );
    await db.exec(
      'CREATE ROLE catalog_anon; GRANT SELECT ON "GraceProviderKey", "GraceModel", "GraceKeyModel", "User", "Chat" TO catalog_anon; SET ROLE catalog_anon;'
    );
    assert.equal(
      (await db.query('SELECT * FROM "GraceProviderKey"')).rows.length,
      0
    );
    assert.equal((await db.query('SELECT * FROM "GraceModel"')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM "Chat"')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM "User"')).rows.length, 0);
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});
