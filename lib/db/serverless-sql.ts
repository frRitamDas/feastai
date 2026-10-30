import type postgres from "postgres";

type Sql = postgres.Sql;

/**
 * Bound for a single database operation in a serverless function. Well below
 * Vercel's function timeout; real Grace queries complete in milliseconds, so
 * reaching this bound means the connection is dead, not slow.
 */
const QUERY_TIMEOUT_MS = 30_000;

/**
 * A postgres.js instance that replaces itself when one of its connections is
 * stuck.
 *
 * A frozen function instance can resume with a pooler socket whose TCP state
 * was silently dropped, or with its single connection slot pinned by an
 * in-flight operation that never settled. postgres.js then waits forever for
 * a reply or a free connection and the request hangs until Vercel kills the
 * function. Instead, every operation is watched: if it does not settle within
 * the bound, the whole instance is discarded (terminating its sockets, which
 * rejects the stuck in-flight query and frees the pinned slot). The affected
 * request fails fast with a retryable error and the next request gets a
 * fresh connection.
 */
class ServerlessSql {
  private readonly factory: () => Sql;
  private instance: Sql;
  private discardInFlight: Promise<void> | undefined;

  constructor(factory: () => Sql) {
    this.factory = factory;
    this.instance = factory();
  }

  get current(): Sql {
    return this.instance;
  }

  end(): Promise<void> {
    return this.instance.end();
  }

  /**
   * Discard the current instance, terminating all of its connections. The
   * stuck in-flight query on the old instance is rejected (failing the hung
   * request) and any queued queries are dropped, so the pinned slot can never
   * block future operations.
   */
  discard(): Promise<void> {
    if (!this.discardInFlight) {
      const dead = this.instance;
      this.instance = this.factory();
      this.discardInFlight = dead
        .end({ timeout: 1 })
        .catch(() => undefined)
        .finally(() => {
          this.discardInFlight = undefined;
        });
    }
    return this.discardInFlight;
  }
}

/**
 * Build a stable `postgres.Sql`-shaped facade over a replaceable underlying
 * instance. Drizzle instances and module-level references can hold the facade
 * forever; the real connections are regenerated beneath it when a stuck
 * operation forces a discard. `unsafe`, `begin` and `transaction` return
 * per-operation thenables and are watched for liveness; the thenable itself
 * is returned untouched so callers keep postgres.js' result-shape methods
 * (`.values()` and friends).
 */
export function createServerlessSql(
  factory: () => Sql,
  timeoutMs = QUERY_TIMEOUT_MS
): {
  end: () => Promise<void>;
  sql: Sql;
} {
  const serverless = new ServerlessSql(factory);
  const watched =
    (prop: string) =>
    (...args: unknown[]) => {
      const operation = (
        serverless.current as unknown as Record<
          string,
          (...a: unknown[]) => unknown
        >
      )[prop](...args);
      if (
        operation &&
        typeof (operation as { then?: unknown }).then === "function"
      ) {
        const thenable = operation as Promise<unknown>;
        const timer = setTimeout(() => {
          serverless.discard().catch(() => undefined);
        }, timeoutMs);
        thenable.then(
          () => clearTimeout(timer),
          () => clearTimeout(timer)
        );
      }
      return operation;
    };
  const sql: Sql = new Proxy({} as Sql, {
    get: (_target, prop) => {
      if (
        typeof prop === "string" &&
        prop !== "constructor" &&
        (prop === "unsafe" || prop === "begin" || prop === "transaction")
      ) {
        return watched(prop);
      }
      const value = Reflect.get(serverless.current, prop);
      return typeof value === "function"
        ? value.bind(serverless.current)
        : value;
    },
    has: (_target, prop) =>
      typeof prop === "string" &&
      (prop === "unsafe" || prop === "begin" || prop === "transaction")
        ? true
        : prop in serverless.current,
  });
  return { end: () => serverless.end(), sql };
}
