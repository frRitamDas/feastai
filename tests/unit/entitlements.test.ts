// biome-ignore-all lint/performance/noAwaitInLoops: Migrations must be applied sequentially.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { EFFECTIVE_ENTITLEMENT_SQL } from "../../lib/server/security/entitlements";

test("manual entitlements expire using the database clock and preserve existing access", async () => {
  const db = new PGlite();
  try {
    for (const migration of [
      "0000_initial",
      "0001_grace_provider_catalog",
      "0005_grace_administration",
      "0010_grace_routing_groups",
      "0013_grace_account_policies",
    ]) {
      await db.exec(
        await readFile(`lib/db/migrations/${migration}.sql`, "utf8")
      );
    }
    const [user] = (
      await db.query<{ id: string }>(
        'INSERT INTO "User" ("email") VALUES (\'existing@example.com\') RETURNING "id"'
      )
    ).rows;
    await db.exec(
      'INSERT INTO "GraceModel" ("provider", "upstreamId", "name", "enabled") VALUES (\'groq\', \'existing\', \'Existing\', true); INSERT INTO "GraceRouteGroup" ("name", "enabled") VALUES (\'Existing route\', true)'
    );
    await db.exec(
      await readFile(
        "lib/db/migrations/0021_grace_model_entitlements.sql",
        "utf8"
      )
    );
    assert.equal(
      (await db.query<{ plan: string }>(EFFECTIVE_ENTITLEMENT_SQL, [user.id]))
        .rows[0].plan,
      "free"
    );
    assert.equal(
      (
        await db.query<{ requiredPlan: string }>(
          'SELECT "requiredPlan" FROM "GraceModel"'
        )
      ).rows[0].requiredPlan,
      "free"
    );
    assert.equal(
      (
        await db.query<{ requiredPlan: string }>(
          'SELECT "requiredPlan" FROM "GraceRouteGroup"'
        )
      ).rows[0].requiredPlan,
      "free"
    );
    await db.query(
      'INSERT INTO "GraceUserPolicy" ("userId", "plan", "planExpiresAt") VALUES ($1, \'custom\', now() - interval \'1 second\')',
      [user.id]
    );
    assert.equal(
      (await db.query<{ plan: string }>(EFFECTIVE_ENTITLEMENT_SQL, [user.id]))
        .rows[0].plan,
      "free"
    );
    await db.query(
      'UPDATE "GraceUserPolicy" SET "planExpiresAt" = now() + interval \'1 day\' WHERE "userId" = $1',
      [user.id]
    );
    assert.equal(
      (await db.query<{ plan: string }>(EFFECTIVE_ENTITLEMENT_SQL, [user.id]))
        .rows[0].plan,
      "custom"
    );
    await db.query(
      'UPDATE "GraceUserPolicy" SET "enabled" = false WHERE "userId" = $1',
      [user.id]
    );
    assert.equal(
      (await db.query(EFFECTIVE_ENTITLEMENT_SQL, [user.id])).rows.length,
      0
    );
    await db.query(
      'UPDATE "GraceUserPolicy" SET "enabled" = true, "plan" = \'free\' WHERE "userId" = $1',
      [user.id]
    );
    await db.query(
      'INSERT INTO "GraceAdministrator" ("userId", "role", "totpSecret") VALUES ($1, \'owner\', \'{}\'::jsonb)',
      [user.id]
    );
    assert.equal(
      (await db.query<{ plan: string }>(EFFECTIVE_ENTITLEMENT_SQL, [user.id]))
        .rows[0].plan,
      "custom"
    );
  } finally {
    await db.close();
  }
});
