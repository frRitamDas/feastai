import assert from "node:assert/strict";
import test from "node:test";

import { createServerlessSql } from "../../lib/db/serverless-sql";

/**
 * Faithful stand-in for a postgres.js operation thenable: `.values()` is
 * shape-only and returns the same thenable; the operation settles
 * asynchronously, and a discarded instance rejects every unsettled operation
 * (postgres.js does the same when it terminates its connections).
 */
type FakeQuery = {
  then: (
    onfulfilled?: (value: unknown) => unknown,
    onrejected?: (error: unknown) => unknown
  ) => Promise<unknown>;
  values: () => FakeQuery;
};
type FakeSql = {
  begin: (run: (tx: FakeSql) => Promise<unknown>) => Promise<unknown>;
  end: (options?: { timeout?: number | null }) => Promise<void>;
  ended: boolean;
  unsafe: (text: string, params?: unknown[]) => FakeQuery;
};
type InstanceSpec = {
  hang?: boolean;
  rejectWith?: Error;
};
const destroyed = () => new Error("CONNECTION_DESTROYED");

function createFake(spec: InstanceSpec, log: FakeSql[]): FakeSql {
  const pending: { done: boolean; reject: (error: Error) => void }[] = [];
  const settleAll = (error: Error) => {
    for (const entry of pending) {
      if (!entry.done) {
        entry.done = true;
        entry.reject(error);
      }
    }
  };
  const instance: FakeSql = {
    begin: (run) => {
      if (spec.hang) {
        let reject!: (error: Error) => void;
        const operation = new Promise<unknown>((_, r) => {
          reject = r;
        });
        const entry = {
          done: false,
          reject: (error: Error) => reject(error),
        };
        pending.push(entry);
        return operation;
      }
      return Promise.resolve().then(() => run(instance));
    },
    end: () => {
      instance.ended = true;
      settleAll(destroyed());
      return Promise.resolve();
    },
    ended: false,
    unsafe: () => {
      let resolve!: (value: unknown) => void;
      let reject!: (error: Error) => void;
      const operation = new Promise<unknown>((r, j) => {
        resolve = r;
        reject = j;
      });
      const entry = {
        done: false,
        reject: (error: Error) => reject(error),
      };
      pending.push(entry);
      const markDone = () => {
        entry.done = true;
      };
      if (spec.rejectWith) {
        Promise.resolve().then(() => {
          markDone();
          reject(spec.rejectWith as Error);
        });
      } else if (!spec.hang) {
        Promise.resolve().then(() => {
          markDone();
          resolve([{ ok: true }]);
        });
      }
      operation.then(
        () => markDone(),
        () => markDone()
      );
      const query: FakeQuery = {
        // biome-ignore lint/suspicious/noThenProperty: intentional postgres.js thenable stand-in.
        then: (onfulfilled, onrejected) =>
          operation.then(onfulfilled, onrejected),
        values: () => query,
      };
      return query;
    },
  };
  log.push(instance);
  return instance;
}

function createHarness(specs: InstanceSpec[], timeoutMs = 60) {
  const instances: FakeSql[] = [];
  const { sql, end } = createServerlessSql(
    () =>
      createFake(specs[instances.length] ?? { hang: true }, instances) as never,
    timeoutMs
  );
  return { end, instances, sql };
}

test("a stuck query fails after the bound and the next query is fresh", async () => {
  const { instances, sql } = createHarness([{ hang: true }, {}]);
  const stuck = sql.unsafe("SELECT 1");
  await assert.rejects(Promise.resolve(stuck), /CONNECTION_DESTROYED/);
  assert.equal(instances.length, 2);
  assert.equal(instances[0].ended, true);
  const rows = await sql.unsafe("SELECT 1");
  assert.deepEqual(rows, [{ ok: true }]);
  assert.equal(instances[1].ended, false);
});

test("a stuck transaction fails after the bound and the next query is fresh", async () => {
  const { instances, sql } = createHarness([{ hang: true }, {}]);
  await assert.rejects(
    () => sql.begin(async () => undefined),
    /CONNECTION_DESTROYED/
  );
  assert.equal(instances.length, 2);
  assert.equal(instances[0].ended, true);
  const rows = await sql.unsafe("SELECT 1");
  assert.deepEqual(rows, [{ ok: true }]);
});

test("real errors propagate immediately without discarding", async () => {
  const boom = new Error("schema missing");
  const { instances, sql } = createHarness([{ rejectWith: boom }]);
  await assert.rejects(
    Promise.resolve(sql.unsafe("SELECT 1")),
    (error: unknown) => {
      assert.equal(error, boom);
      return true;
    }
  );
  assert.equal(instances.length, 1);
  assert.equal(instances[0].ended, false);
});

test("postgres.js result-shape methods survive the facade", async () => {
  const { instances, sql } = createHarness([{}]);
  const rows = await sql.unsafe("SELECT 1").values();
  assert.deepEqual(rows, [{ ok: true }]);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].ended, false);
});

test("a healthy connection is never discarded", async () => {
  const { instances, sql } = createHarness([{}]);
  const rows = await sql.unsafe("SELECT 1");
  assert.deepEqual(rows, [{ ok: true }]);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].ended, false);
});

test("the facade reports the real instance's own methods", () => {
  const { sql } = createHarness([{}]);
  assert.ok("begin" in sql);
  assert.ok("unsafe" in sql);
  assert.ok("end" in sql);
});
