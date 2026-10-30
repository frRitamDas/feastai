import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import {
  decryptCredential,
  type EncryptedCredential,
  encryptCredential,
} from "../credential-crypto";
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
      'SELECT "id", "provider", "label", "enabled", "discoveryStatus", "lastDiscoveryAt", "createdAt" FROM "GraceProviderKey" ORDER BY "createdAt" DESC'
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
      'SELECT m."id", m."provider", m."upstreamId", m."name", m."enabled", p."keyId", p."permitted", p."available", p."verifiedAt" FROM "GraceModel" m JOIN "GraceKeyModel" p ON p."modelId" = m."id" ORDER BY m."provider", m."name", p."keyId"'
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
    let success = false;
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
      success = result.text.trim().length > 0;
    } catch {
      // Never expose upstream error bodies, which may contain credentials.
    }
    if (success) {
      // Re-check ciphertext and availability to avoid validating a changed key.
      const rows = await this.db.query(
        `UPDATE "GraceKeyModel" p SET "verifiedAt" = now()
         FROM "GraceProviderKey" k WHERE p."keyId" = $1 AND p."modelId" = $2
         AND p."available" = true AND k."id" = p."keyId" AND k."encryptedCredential" = $3::jsonb
         RETURNING p."keyId"`,
        [keyId, modelId, JSON.stringify(row.encryptedCredential)]
      );
      return rows.length > 0;
    }
    return false;
  }

  async resolve(modelId: string): Promise<{
    provider: DiscoveryProvider;
    upstreamId: string;
    credential: string;
  } | null> {
    validId(modelId);
    const [row] = await this.db.query<StoredKey & { upstreamId: string }>(
      `SELECT k."id", k."provider", k."encryptedCredential", m."upstreamId"
       FROM "GraceModel" m JOIN "GraceKeyModel" p ON p."modelId" = m."id"
       JOIN "GraceProviderKey" k ON k."id" = p."keyId"
       WHERE m."id" = $1 AND m."enabled" = true AND p."permitted" = true
       AND p."available" = true AND p."verifiedAt" IS NOT NULL AND k."enabled" = true
       ORDER BY k."createdAt", k."id" LIMIT 1`,
      [modelId]
    );
    if (!row) {
      return null;
    }
    return {
      credential: decryptCredential(
        row.encryptedCredential,
        row.id,
        this.encryptionKey
      ),
      provider: row.provider,
      upstreamId: row.upstreamId,
    };
  }

  listPublicModels() {
    return this.db.query(
      'SELECT DISTINCT m."id", m."provider", m."upstreamId", m."name" FROM "GraceModel" m JOIN "GraceKeyModel" p ON p."modelId" = m."id" JOIN "GraceProviderKey" k ON k."id" = p."keyId" WHERE m."enabled" = true AND p."permitted" = true AND p."available" = true AND p."verifiedAt" IS NOT NULL AND k."enabled" = true ORDER BY m."name", m."id"'
    );
  }
}
