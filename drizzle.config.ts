import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import {
  resolveDatabaseUrl,
  supabasePoolerOptions,
} from "./lib/db/connection-url";

config({
  path: ".env.local",
});

const databaseUrl = resolveDatabaseUrl(
  process.env.POSTGRES_URL ?? "",
  process.env.GRACE_SUPABASE_POOLER_HOST
);
const options = supabasePoolerOptions(databaseUrl);
const pooler = options.ssl ? new URL(databaseUrl) : null;

export default defineConfig({
  // Drizzle Kit uses named prepared statements, so its schema tooling uses
  // session mode. Application requests instead use transaction mode.
  dbCredentials: pooler
    ? {
        database: decodeURIComponent(pooler.pathname.slice(1)) || "postgres",
        host: pooler.hostname,
        password: decodeURIComponent(pooler.password),
        port: 5432,
        ssl: options.ssl,
        user: decodeURIComponent(pooler.username),
      }
    : { url: databaseUrl },
  dialect: "postgresql",
  out: "./lib/db/migrations",
  schema: "./lib/db/schema.ts",
});
