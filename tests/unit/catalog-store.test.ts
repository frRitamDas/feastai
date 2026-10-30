import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import {
  type CatalogDatabase,
  CatalogStore,
} from "../../lib/server/catalog/store";

function adapter(database: PGlite | Transaction): CatalogDatabase {
  return {
    query: async <T extends Record<string, unknown>>(
      sql: string,
      params?: unknown[]
    ) => (await database.query<T>(sql, params)).rows,
    transaction: <T>(run: (tx: CatalogDatabase) => Promise<T>) => {
      if (!(database instanceof PGlite)) {
        throw new Error("Nested transaction is not supported");
      }
      return database.transaction((tx) => run(adapter(tx)));
    },
  };
}

test("provider catalog encrypts keys, persists discovery and enforces permissions", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(
        "lib/db/migrations/0001_grace_provider_catalog.sql",
        "utf8"
      )
    );
    const store = new CatalogStore(
      adapter(db),
      randomBytes(32).toString("base64")
    );
    const key = await store.addKey({
      credential: "private-example-key",
      label: "Primary",
      provider: "groq",
    });
    assert.equal(
      JSON.stringify(await store.listKeys()).includes("private-example-key"),
      false
    );
    const records = await db.query(
      'SELECT "encryptedCredential" FROM "GraceProviderKey"'
    );
    assert.equal(
      JSON.stringify(records.rows).includes("private-example-key"),
      false
    );
    const mock: typeof fetch = () =>
      Promise.resolve(
        Response.json({ data: [{ id: "model-a", name: "Model A" }] })
      );
    assert.equal((await store.discover(key, mock)).status, "discovered");
    const models = await db.query<{ id: string }>(
      'SELECT "id" FROM "GraceModel"'
    );
    const model = models.rows[0].id;
    assert.deepEqual(await store.listPublicModels(), []);
    await store.setKeyEnabled(key, true);
    await store.setModelEnabled(model, true);
    assert.deepEqual(await store.listPublicModels(), []);
    await store.setPermission(key, model, true);
    assert.deepEqual(await store.listPublicModels(), []);
    const verify: typeof fetch = (input, init) => {
      assert.equal(
        String(input),
        "https://api.groq.com/openai/v1/chat/completions"
      );
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer private-example-key"
      );
      return Promise.resolve(
        Response.json({
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: { content: "OK", role: "assistant" },
            },
          ],
          id: "test",
          model: "model-a",
          usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
        })
      );
    };
    assert.equal(await store.verify(key, model, verify), true);
    assert.equal((await store.listPublicModels()).length, 1);
    assert.equal((await store.resolve(model))?.upstreamId, "model-a");
    assert.equal(
      await store.verify(key, model, () =>
        Promise.resolve(new Response("not authorized", { status: 401 }))
      ),
      false
    );
    assert.deepEqual(await store.listPublicModels(), []);
    assert.equal(await store.resolve(model), null);
    assert.equal(await store.verify(key, model, verify), true);
    await store.discover(key, () =>
      Promise.resolve(Response.json({ data: [] }))
    );
    assert.deepEqual(await store.listPublicModels(), []);
    await assert.rejects(store.setPermission(key, model, true));
    await store.deleteKey(key);
    assert.equal(
      (await db.query('SELECT * FROM "GraceKeyModel"')).rows.length,
      0
    );
  } finally {
    await db.close();
  }
});
