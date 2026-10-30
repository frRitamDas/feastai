import { randomUUID } from "node:crypto";
import { APICallError } from "@ai-sdk/provider";
import { generateText } from "ai";
import {
  decryptCredential,
  type EncryptedCredential,
  encryptCredential,
} from "../credential-crypto";
import { parseCloudflareCredential } from "../providers/cloudflare";
import { parseCustomCredential } from "../providers/custom";
import {
  type DiscoveryProvider,
  type DiscoveryResult,
  discoverModels,
} from "../providers/discovery";
import { createProviderModel } from "../providers/inference";

/** Database access must be injected by trusted server code, never by a client. */
export interface CatalogDatabase {
  query: <T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<T[]>;
  transaction: <T>(run: (tx: CatalogDatabase) => Promise<T>) => Promise<T>;
}

const PROVIDERS = new Set([
  "groq",
  "gemini",
  "cloudflare",
  "custom",
  "huggingface",
  "openrouter",
  "cerebras",
  "sambanova",
  "mistral",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validId(id: string) {
  if (!UUID.test(id)) {
    throw new Error("Invalid identifier");
  }
}

type StoredKey = {
  id: string;
  provider: DiscoveryProvider;
  encryptedCredential: EncryptedCredential;
};

/** These methods are internal primitives. Callers MUST enforce authorization,
 * CSRF, auditing and rate limits before exposing any mutation over HTTP. */
export class CatalogStore {
  private readonly db: CatalogDatabase;
  private readonly encryptionKey: string | undefined;
  constructor(db: CatalogDatabase, encryptionKey: string | undefined) {
    this.db = db;
    this.encryptionKey = encryptionKey;
  }

  async addKey(input: {
    provider: string;
    label: string;
    credential: string;
  }): Promise<string> {
    const label = input.label.trim();
    if (
      !PROVIDERS.has(input.provider) ||
      !label ||
      label.length > 100 ||
      !input.credential ||
      input.credential.length > 8192 ||
      /[\r\n]/.test(input.credential)
    ) {
      throw new Error("Invalid provider credential configuration");
    }
    if (input.provider === "custom") {
      parseCustomCredential(input.credential);
    }
    if (input.provider === "cloudflare") {
      parseCloudflareCredential(input.credential);
    }
    const id = randomUUID();
    const envelope = encryptCredential(
      input.credential,
      id,
      this.encryptionKey
    );
    await this.db.query(
      'INSERT INTO "GraceProviderKey" ("id", "provider", "label", "encryptedCredential") VALUES ($1, $2, $3, $4::jsonb)',
      [id, input.provider, label, JSON.stringify(envelope)]
    );
    return id;
  }

  listKeys() {
    // Deliberately never SELECT encryptedCredential here.
    return this.db.query(
      'SELECT "id", "provider", "label", "enabled", "priority", "discoveryStatus", "lastDiscoveryAt", "createdAt" FROM "GraceProviderKey" ORDER BY "createdAt" DESC'
    );
  }

  async discover(
    keyId: string,
    request: typeof fetch = fetch
  ): Promise<DiscoveryResult> {
    validId(keyId);
    const [row] = await this.db.query<StoredKey>(
      'SELECT "id", "provider", "encryptedCredential" FROM "GraceProviderKey" WHERE "id" = $1',
      [keyId]
    );
    if (!row) {
      throw new Error("Provider key not found");
    }
    const credential = decryptCredential(
      row.encryptedCredential,
      row.id,
      this.encryptionKey
    );
    const result = await discoverModels(row.provider, credential, request);
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.query<StoredKey>(
        'SELECT "id", "provider", "encryptedCredential" FROM "GraceProviderKey" WHERE "id" = $1 FOR UPDATE',
        [keyId]
      );
      if (
        !locked ||
        JSON.stringify(locked.encryptedCredential) !==
          JSON.stringify(row.encryptedCredential)
      ) {
        throw new Error("Provider key changed during discovery");
      }
      await tx.query(
        'UPDATE "GraceProviderKey" SET "discoveryStatus" = $2, "lastDiscoveryAt" = now(), "updatedAt" = now() WHERE "id" = $1',
        [keyId, result.status]
      );
      if (result.status !== "discovered") {
        return;
      }
      const payload = JSON.stringify(result.models);
      await tx.query(
        `INSERT INTO "GraceModel" ("provider", "upstreamId", "name")
         SELECT $1, m.id, m.name FROM jsonb_to_recordset($2::jsonb) AS m(id text, name text)
         ON CONFLICT ("provider", "upstreamId") DO UPDATE
         SET "name" = EXCLUDED."name", "lastDiscoveredAt" = now()`,
        [row.provider, payload]
      );
      await tx.query(
        `UPDATE "GraceKeyModel" SET "permitted" = false, "available" = false, "verifiedAt" = NULL
         WHERE "keyId" = $1 AND NOT EXISTS (
           SELECT 1 FROM "GraceModel" m JOIN jsonb_to_recordset($2::jsonb) AS d(id text, name text)
           ON m."upstreamId" = d.id WHERE m."id" = "GraceKeyModel"."modelId"
         )`,
        [keyId, payload]
      );
      await tx.query(
        `INSERT INTO "GraceKeyModel" ("keyId", "modelId", "provider", "available")
         SELECT $1::uuid, m."id", $2::varchar(32), true FROM "GraceModel" m
         JOIN jsonb_to_recordset($3::jsonb) AS d(id text, name text) ON m."upstreamId" = d.id
         WHERE m."provider" = $2::varchar(32)
         ON CONFLICT ("keyId", "modelId") DO UPDATE
         SET "available" = true, "lastDiscoveredAt" = now()`,
        [keyId, row.provider, payload]
      );
    });
    return result;
  }

  async setKeyEnabled(id: string, enabled: boolean) {
    validId(id);
    const rows = await this.db.query(
      'UPDATE "GraceProviderKey" SET "enabled" = $2, "updatedAt" = now() WHERE "id" = $1 RETURNING "id"',
      [id, enabled]
    );
    if (!rows.length) {
      throw new Error("Provider key not found");
    }
  }

  async setModelEnabled(id: string, enabled: boolean) {
    validId(id);
    const rows = await this.db.query(
      'UPDATE "GraceModel" SET "enabled" = $2 WHERE "id" = $1 RETURNING "id"',
      [id, enabled]
    );
    if (!rows.length) {
      throw new Error("Model not found");
    }
  }

  async setPermission(keyId: string, modelId: string, permitted: boolean) {
    validId(keyId);
    validId(modelId);
    const rows = await this.db.query(
      'UPDATE "GraceKeyModel" SET "permitted" = $3 WHERE "keyId" = $1 AND "modelId" = $2 AND ("available" = true OR $3 = false) RETURNING "modelId"',
      [keyId, modelId, permitted]
    );
    if (!rows.length) {
      throw new Error("Model is not associated with this key");
    }
  }

  async setKeyPriority(id: string, priority: number) {
    validId(id);
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
      throw new Error("Invalid priority");
    }
    const rows = await this.db.query(
      'UPDATE "GraceProviderKey" SET "priority" = $2, "updatedAt" = now() WHERE "id" = $1 RETURNING "id"',
      [id, priority]
    );
    if (!rows.length) {
      throw new Error("Key not found");
    }
  }

  async registerModel(keyId: string, upstreamId: string, name: string) {
    validId(keyId);
    const model = upstreamId.trim();
    const label = name.trim();
    if (
      !model ||
      model.length > 300 ||
      !label ||
      label.length > 300 ||
      /[\r\n]/.test(model)
    ) {
      throw new Error("Invalid model");
    }
    return await this.db.transaction(async (tx) => {
      const [key] = await tx.query<{ provider: string }>(
        'SELECT "provider" FROM "GraceProviderKey" WHERE "id" = $1 FOR UPDATE',
        [keyId]
      );
      if (!key) {
        throw new Error("Key not found");
      }
      const [row] = await tx.query<{ id: string }>(
        'INSERT INTO "GraceModel" ("provider", "upstreamId", "name") VALUES ($1, $2, $3) ON CONFLICT ("provider", "upstreamId") DO UPDATE SET "name" = EXCLUDED."name" RETURNING "id"',
        [key.provider, model, label]
      );
      await tx.query(
        'INSERT INTO "GraceKeyModel" ("keyId", "modelId", "provider", "available") VALUES ($1, $2, $3, true) ON CONFLICT ("keyId", "modelId") DO UPDATE SET "available" = true, "verifiedAt" = NULL',
        [keyId, row.id, key.provider]
      );
      return row.id;
    });
  }

  async deleteKey(id: string) {
    validId(id);
    const rows = await this.db.query(
      'DELETE FROM "GraceProviderKey" WHERE "id" = $1 RETURNING "id"',
      [id]
    );
    if (!rows.length) {
      throw new Error("Provider key not found");
    }
  }

  listCatalog() {
    return this.db.query(
      'SELECT m."id", m."provider", m."upstreamId", m."name", m."enabled", p."keyId", p."permitted", p."available", p."verifiedAt", p."lastCheckAt", p."lastCheckStatus", p."lastLatencyMs" FROM "GraceModel" m JOIN "GraceKeyModel" p ON p."modelId" = m."id" ORDER BY m."provider", m."name", p."keyId"'
    );
  }

  async verify(
    keyId: string,
    modelId: string,
    request: typeof fetch = fetch
  ): Promise<boolean> {
    validId(keyId);
    validId(modelId);
    const [row] = await this.db.query<StoredKey & { upstreamId: string }>(
      `SELECT k."id", k."provider", k."encryptedCredential", m."upstreamId"
       FROM "GraceProviderKey" k JOIN "GraceKeyModel" p ON p."keyId" = k."id"
       JOIN "GraceModel" m ON m."id" = p."modelId"
       WHERE k."id" = $1 AND m."id" = $2 AND p."available" = true`,
      [keyId, modelId]
    );
    if (!row) {
      throw new Error("Model is not available for this key");
    }
    // Invalidate first: concurrent readers must not use a stale successful check.
    await this.db.query(
      'UPDATE "GraceKeyModel" SET "verifiedAt" = NULL WHERE "keyId" = $1 AND "modelId" = $2',
      [keyId, modelId]
    );
    const credential = decryptCredential(
      row.encryptedCredential,
      keyId,
      this.encryptionKey
    );
    let status = "unavailable";
    const started = Date.now();
    try {
      const result = await generateText({
        abortSignal: AbortSignal.timeout(15_000),
        maxOutputTokens: 8,
        maxRetries: 0,
        model: createProviderModel(
          row.provider,
          row.upstreamId,
          credential,
          request
        ),
        prompt: "Reply with OK.",
      });
      status = result.text.trim().length > 0 ? "success" : "invalid_response";
    } catch (error) {
      if (
        APICallError.isInstance(error) &&
        (error.statusCode === 401 || error.statusCode === 403)
      ) {
        status = "authentication_failed";
      } else if (APICallError.isInstance(error) && error.statusCode === 429) {
        status = "rate_limited";
      }
      // Never store provider error bodies or credentials.
    }
    const latency = Math.max(0, Math.min(Date.now() - started, 2_147_483_647));
    // Re-check ciphertext and availability to avoid recording a changed key.
    const rows = await this.db.query(
      `UPDATE "GraceKeyModel" p SET "verifiedAt" = CASE WHEN $4::text = 'success' THEN now() ELSE NULL END,
       "lastCheckAt" = now(), "lastCheckStatus" = $4, "lastLatencyMs" = $5
       FROM "GraceProviderKey" k WHERE p."keyId" = $1 AND p."modelId" = $2
       AND p."available" = true AND k."id" = p."keyId" AND k."encryptedCredential" = $3::jsonb
       RETURNING p."keyId"`,
      [keyId, modelId, JSON.stringify(row.encryptedCredential), status, latency]
    );
    return status === "success" && rows.length > 0;
  }

  async resolveCandidates(modelId: string): Promise<
    Array<{
      provider: DiscoveryProvider;
      upstreamId: string;
      credential: string;
    }>
  > {
    validId(modelId);
    const rows = await this.db.query<StoredKey & { upstreamId: string }>(
      `SELECT k."id", k."provider", k."encryptedCredential", m."upstreamId"
       FROM "GraceModel" m JOIN "GraceKeyModel" p ON p."modelId" = m."id"
       JOIN "GraceProviderKey" k ON k."id" = p."keyId"
       WHERE m."id" = $1 AND m."enabled" = true AND p."permitted" = true
       AND p."available" = true AND p."verifiedAt" IS NOT NULL AND k."enabled" = true
       ORDER BY k."priority", k."createdAt", k."id" LIMIT 3`,
      [modelId]
    );
    return rows.map((row) => ({
      credential: decryptCredential(
        row.encryptedCredential,
        row.id,
        this.encryptionKey
      ),
      provider: row.provider,
      upstreamId: row.upstreamId,
    }));
  }

  async resolve(modelId: string) {
    return (await this.resolveCandidates(modelId))[0] ?? null;
  }

  async createRoute(name: string) {
    const label = name.trim();
    if (!label || label.length > 100) {
      throw new Error("Invalid route name");
    }
    const [row] = await this.db.query<{ id: string }>(
      'INSERT INTO "GraceRouteGroup" ("name") VALUES ($1) RETURNING "id"',
      [label]
    );
    return row.id;
  }

  async setRouteEnabled(routeId: string, enabled: boolean) {
    validId(routeId);
    const rows = await this.db.query(
      'UPDATE "GraceRouteGroup" SET "enabled" = $2 WHERE "id" = $1 RETURNING "id"',
      [routeId, enabled]
    );
    if (!rows.length) {
      throw new Error("Route not found");
    }
  }

  async setRouteMember(routeId: string, modelId: string, priority: number) {
    validId(routeId);
    validId(modelId);
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
      throw new Error("Invalid priority");
    }
    await this.db.query(
      'INSERT INTO "GraceRouteMember" ("routeId", "modelId", "priority") VALUES ($1, $2, $3) ON CONFLICT ("routeId", "modelId") DO UPDATE SET "priority" = EXCLUDED."priority"',
      [routeId, modelId, priority]
    );
  }

  async removeRouteMember(routeId: string, modelId: string) {
    validId(routeId);
    validId(modelId);
    const rows = await this.db.query(
      'DELETE FROM "GraceRouteMember" WHERE "routeId" = $1 AND "modelId" = $2 RETURNING "modelId"',
      [routeId, modelId]
    );
    if (!rows.length) {
      throw new Error("Route member not found");
    }
  }

  listRoutes() {
    return this.db.query(
      'SELECT r."id", r."name", r."enabled", p."modelId", p."priority", m."name" AS "modelName", m."provider" FROM "GraceRouteGroup" r LEFT JOIN "GraceRouteMember" p ON p."routeId" = r."id" LEFT JOIN "GraceModel" m ON m."id" = p."modelId" ORDER BY r."createdAt", p."priority", p."modelId"'
    );
  }

  listPublicRoutes() {
    return this.db.query(
      'SELECT DISTINCT r."id", r."name" FROM "GraceRouteGroup" r JOIN "GraceRouteMember" rm ON rm."routeId" = r."id" JOIN "GraceModel" m ON m."id" = rm."modelId" JOIN "GraceKeyModel" p ON p."modelId" = m."id" JOIN "GraceProviderKey" k ON k."id" = p."keyId" WHERE r."enabled" = true AND m."enabled" = true AND p."permitted" = true AND p."available" = true AND p."verifiedAt" IS NOT NULL AND k."enabled" = true ORDER BY r."name", r."id"'
    );
  }

  async resolveRouteCandidates(routeId: string): Promise<
    Array<{
      provider: DiscoveryProvider;
      upstreamId: string;
      credential: string;
    }>
  > {
    validId(routeId);
    const rows = await this.db.query<StoredKey & { upstreamId: string }>(
      `SELECT "id", "provider", "encryptedCredential", "upstreamId" FROM (
         SELECT k."id", k."provider", k."encryptedCredential", m."upstreamId", rm."priority" AS "routePriority", k."priority" AS "keyPriority", k."createdAt",
           row_number() OVER (PARTITION BY m."id" ORDER BY k."priority", k."createdAt", k."id") AS "keyRank"
         FROM "GraceRouteGroup" r JOIN "GraceRouteMember" rm ON rm."routeId" = r."id"
         JOIN "GraceModel" m ON m."id" = rm."modelId" JOIN "GraceKeyModel" p ON p."modelId" = m."id"
         JOIN "GraceProviderKey" k ON k."id" = p."keyId"
         WHERE r."id" = $1 AND r."enabled" = true AND m."enabled" = true AND p."permitted" = true
           AND p."available" = true AND p."verifiedAt" IS NOT NULL AND k."enabled" = true
       ) ranked ORDER BY "keyRank", "routePriority", "keyPriority", "createdAt", "id" LIMIT 3`,
      [routeId]
    );
    return rows.map((row) => ({
      credential: decryptCredential(
        row.encryptedCredential,
        row.id,
        this.encryptionKey
      ),
      provider: row.provider,
      upstreamId: row.upstreamId,
    }));
  }

  listPublicModels() {
    return this.db.query(
      'SELECT DISTINCT m."id", m."provider", m."upstreamId", m."name" FROM "GraceModel" m JOIN "GraceKeyModel" p ON p."modelId" = m."id" JOIN "GraceProviderKey" k ON k."id" = p."keyId" WHERE m."enabled" = true AND p."permitted" = true AND p."available" = true AND p."verifiedAt" IS NOT NULL AND k."enabled" = true ORDER BY m."name", m."id"'
    );
  }
}
