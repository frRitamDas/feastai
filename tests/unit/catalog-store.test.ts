// biome-ignore-all lint/performance/noAwaitInLoops: Migration and catalog operations must run in order.
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
    await db.exec(
      await readFile("lib/db/migrations/0004_grace_gemini_provider.sql", "utf8")
    );
    await db.exec(
      await readFile(
        "lib/db/migrations/0006_grace_routing_priority.sql",
        "utf8"
      )
    );
    await db.exec(
      await readFile(
        "lib/db/migrations/0007_grace_huggingface_provider.sql",
        "utf8"
      )
    );
    await db.exec(
      await readFile(
        "lib/db/migrations/0009_grace_cloudflare_provider.sql",
        "utf8"
      )
    );
    await db.exec(
      await readFile("lib/db/migrations/0010_grace_routing_groups.sql", "utf8")
    );
    await db.exec(
      await readFile("lib/db/migrations/0011_grace_custom_provider.sql", "utf8")
    );
    await db.exec(
      await readFile(
        "lib/db/migrations/0012_grace_verification_health.sql",
        "utf8"
      )
    );
    await db.exec(
      await readFile("lib/db/migrations/0020_grace_runtime_routing.sql", "utf8")
    );
    await db.exec('CREATE TABLE "User" ("id" uuid PRIMARY KEY, "email" text)');
    await db.exec(
      await readFile(
        "lib/db/migrations/0013_grace_account_policies.sql",
        "utf8"
      )
    );
    await db.exec(
      await readFile(
        "lib/db/migrations/0021_grace_model_entitlements.sql",
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
    const alternate = await store.addKey({
      credential: "alternate-key",
      label: "Alternate",
      provider: "groq",
    });
    await store.discover(alternate, mock);
    await store.setKeyEnabled(alternate, true);
    await store.setPermission(alternate, model, true);
    assert.equal(
      await store.verify(alternate, model, () =>
        Promise.resolve(
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
        )
      ),
      true
    );
    await store.setKeyPriority(alternate, 0);
    assert.equal((await store.resolve(model))?.credential, "alternate-key");
    const googleKey = await store.addKey({
      credential: "google-key",
      label: "Google fallback",
      provider: "gemini",
    });
    const googleModel = await store.registerModel(
      googleKey,
      "gemini-test",
      "Gemini test"
    );
    await store.setKeyEnabled(googleKey, true);
    await store.setModelEnabled(googleModel, true);
    await store.setPermission(googleKey, googleModel, true);
    const googleVerify: typeof fetch = () =>
      Promise.resolve(
        Response.json({
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: { content: "OK", role: "assistant" },
            },
          ],
          id: "test",
          model: "gemini-test",
          usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
        })
      );
    assert.equal(
      await store.verify(googleKey, googleModel, googleVerify),
      true
    );
    const route = await store.createRoute("Automatic route");
    await store.setRouteMember(route, model, 10);
    await store.setRouteMember(route, googleModel, 20);
    assert.deepEqual(await store.listPublicRoutes(), []);
    await store.setRouteEnabled(route, true);
    assert.equal((await store.listPublicRoutes()).length, 1);
    const candidates = await store.resolveRouteCandidates(route);
    assert.deepEqual(
      candidates.map((candidate) => candidate.provider),
      ["groq", "gemini", "groq"]
    );
    await store.setModelPlan(googleModel, "custom");
    assert.equal((await store.resolveCandidates(googleModel)).length, 0);
    assert.equal(
      (await store.resolveCandidates(googleModel, "custom")).length,
      1
    );
    assert.equal((await store.listPublicModels()).length, 1);
    assert.equal((await store.listPublicModels("custom")).length, 2);
    assert.deepEqual(
      (await store.resolveRouteCandidates(route)).map((item) => item.provider),
      ["groq", "groq"]
    );
    await store.setRoutePlan(route, "custom");
    assert.equal((await store.listPublicRoutes()).length, 0);
    assert.equal((await store.listPublicRoutes("custom")).length, 1);
    assert.equal((await store.resolveRouteCandidates(route)).length, 0);
    assert.equal(
      (await store.resolveRouteCandidates(route, "custom")).length,
      3
    );
    await store.setRoutePlan(route, "free");
    await store.setModelPlan(googleModel, "free");
    assert.equal((await store.listPublicRoutes())[0].supportsVision, false);
    await store.setModelVision(model, true);
    assert.equal((await store.listPublicRoutes())[0].supportsVision, false);
    await store.setModelVision(googleModel, true);
    assert.equal((await store.listPublicRoutes())[0].supportsVision, true);
    assert.equal((await store.resolve(model))?.supportsVision, true);

    await store.recordConnection(alternate, model, "opened", 400);
    await store.recordConnection(key, model, "opened", 500);
    await store.recordConnection(googleKey, googleModel, "opened", 20);
    await store.setRouteStrategy(route, "fastest");
    assert.equal(
      (await store.resolveRouteCandidates(route))[0].provider,
      "gemini"
    );
    await store.recordConnection(googleKey, googleModel, "unavailable", 30);
    assert.equal(
      (await store.resolveRouteCandidates(route)).some(
        (item) => item.provider === "gemini"
      ),
      false
    );
    const health = (await store.listCatalog()).find(
      (item) => item.keyId === googleKey && item.id === googleModel
    );
    assert.equal(health?.connectionsOpened, 1);
    assert.equal(health?.connectionFailures, 1);
    assert.equal(health?.lastRuntimeStatus, "unavailable");
    assert.ok(health?.cooldownUntil);
    assert.equal(
      await store.verify(googleKey, googleModel, googleVerify),
      true
    );
    assert.equal((await store.resolveRouteCandidates(route)).length, 3);
    await store.setRouteStrategy(route, "manual");
    await store.removeRouteMember(route, model);
    assert.deepEqual(
      (await store.resolveRouteCandidates(route)).map(
        (candidate) => candidate.provider
      ),
      ["gemini"]
    );
    await store.setRouteEnabled(route, false);
    assert.deepEqual(await store.listPublicRoutes(), []);
    await store.deleteKey(googleKey);
    await store.deleteKey(alternate);
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
    const secondKey = await store.addKey({
      credential: "alternate-key",
      label: "Backup",
      provider: "groq",
    });
    const manualId = await store.registerModel(
      secondKey,
      "manual-model",
      "Manual model"
    );
    await store.setKeyPriority(secondKey, 10);
    assert.equal(
      (await store.listKeys()).find((row) => row.id === secondKey)?.priority,
      10
    );
    assert.equal(
      (
        await db.query<{
          available: boolean;
          permitted: boolean;
          verifiedAt: string | null;
        }>(
          'SELECT "available", "permitted", "verifiedAt" FROM "GraceKeyModel" WHERE "keyId" = $1 AND "modelId" = $2',
          [secondKey, manualId]
        )
      ).rows[0].verifiedAt,
      null
    );
    assert.deepEqual(await store.listPublicModels(), []);
    await store.deleteKey(secondKey);
    const gemini = await store.addKey({
      credential: "example-google-key",
      label: "Google",
      provider: "gemini",
    });
    const geminiResult = await store.discover(gemini, () =>
      Promise.resolve(
        Response.json({
          models: [
            {
              name: "models/gemini-test",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        })
      )
    );
    assert.equal(geminiResult.status, "discovered");
    assert.equal(
      (await db.query('SELECT * FROM "GraceProviderKey"')).rows.length,
      2
    );
    await store.deleteKey(gemini);
    await store.deleteKey(key);
    assert.equal(
      (await db.query('SELECT * FROM "GraceKeyModel"')).rows.length,
      0
    );
  } finally {
    await db.close();
  }
});

test("Cloudflare and custom provider credentials stay encrypted through the verified chat path", async () => {
  const db = new PGlite();
  const previous = process.env.GRACE_CUSTOM_PROVIDER_HOSTS;
  process.env.GRACE_CUSTOM_PROVIDER_HOSTS = "api.example.com";
  try {
    await db.exec('CREATE TABLE "User" ("id" uuid PRIMARY KEY, "email" text)');
    for (const migration of [
      "0001_grace_provider_catalog",
      "0004_grace_gemini_provider",
      "0006_grace_routing_priority",
      "0007_grace_huggingface_provider",
      "0009_grace_cloudflare_provider",
      "0010_grace_routing_groups",
      "0011_grace_custom_provider",
      "0012_grace_verification_health",
      "0013_grace_account_policies",
      "0020_grace_runtime_routing",
      "0021_grace_model_entitlements",
    ]) {
      await db.exec(
        await readFile(`lib/db/migrations/${migration}.sql`, "utf8")
      );
    }
    const store = new CatalogStore(
      adapter(db),
      randomBytes(32).toString("base64")
    );
    for (const item of [
      {
        credential: JSON.stringify({
          accountId: "0123456789abcdef0123456789abcdef",
          apiToken: "cloudflare-private",
        }),
        provider: "cloudflare",
      },
      {
        credential: JSON.stringify({
          apiKey: "custom-private",
          baseUrl: "https://api.example.com/v1",
        }),
        provider: "custom",
      },
    ]) {
      const key = await store.addKey({ ...item, label: item.provider });
      const model = await store.registerModel(
        key,
        "model-example",
        `${item.provider} model`
      );
      await store.setKeyEnabled(key, true);
      await store.setModelEnabled(model, true);
      await store.setPermission(key, model, true);
      const verify: typeof fetch = (_url, init) => {
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          `Bearer ${item.provider}-private`
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
            model: "model-example",
            usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
          })
        );
      };
      assert.equal(await store.verify(key, model, verify), true);
      assert.equal((await store.resolve(model))?.credential, item.credential);
    }
    const saved = await db.query(
      'SELECT "encryptedCredential" FROM "GraceProviderKey"'
    );
    assert.equal(JSON.stringify(saved.rows).includes("-private"), false);
    assert.equal((await store.listPublicModels()).length, 2);
    const observations = await db.query<{
      keyId: string;
      modelId: string;
      lastCheckStatus: string;
      lastLatencyMs: number;
    }>(
      'SELECT "keyId", "modelId", "lastCheckStatus", "lastLatencyMs" FROM "GraceKeyModel"'
    );
    assert.equal(
      observations.rows.every(
        (row) => row.lastCheckStatus === "success" && row.lastLatencyMs >= 0
      ),
      true
    );
    const [first] = observations.rows;
    assert.equal(
      await store.verify(first.keyId, first.modelId, () =>
        Promise.resolve(
          Response.json({ error: "private upstream detail" }, { status: 429 })
        )
      ),
      false
    );
    const [failed] = (
      await db.query<{ lastCheckStatus: string; verifiedAt: Date | null }>(
        'SELECT "lastCheckStatus", "verifiedAt" FROM "GraceKeyModel" WHERE "keyId" = $1 AND "modelId" = $2',
        [first.keyId, first.modelId]
      )
    ).rows;
    assert.equal(failed.lastCheckStatus, "rate_limited");
    assert.equal(failed.verifiedAt, null);
    assert.equal((await store.listPublicModels()).length, 1);
  } finally {
    if (previous === undefined) {
      delete process.env.GRACE_CUSTOM_PROVIDER_HOSTS;
    } else {
      process.env.GRACE_CUSTOM_PROVIDER_HOSTS = previous;
    }
    await db.close();
  }
});
