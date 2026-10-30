import postgres from "postgres";
import { resolveDatabaseUrl } from "@/lib/db/connection-url";
import type { CatalogDatabase } from "./store";

/** A server-only adapter. Never construct this using a browser-supplied URL. */
export function createCatalogDatabase(url: string) {
  if (!url) {
    throw new Error("POSTGRES_URL is required");
  }
  const connection = postgres(
    resolveDatabaseUrl(url, process.env.GRACE_SUPABASE_POOLER_HOST),
    { connect_timeout: 10, idle_timeout: 5, max: 1 }
  );
  function wrap(sql: postgres.Sql | postgres.TransactionSql): CatalogDatabase {
    return {
      query: async <T extends Record<string, unknown>>(
        text: string,
        params: unknown[] = []
      ) => {
        const rows = await sql.unsafe<T[]>(
          text,
          params as postgres.ParameterOrJSON<never>[]
        );
        return Array.from(rows);
      },
      transaction: async <T>(run: (tx: CatalogDatabase) => Promise<T>) => {
        if (!("begin" in sql)) {
          throw new Error("Nested transactions are not supported");
        }
        return (await sql.begin((tx) => run(wrap(tx)))) as T;
      },
    };
  }
  return { close: () => connection.end(), database: wrap(connection) };
}
