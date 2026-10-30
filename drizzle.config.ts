import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { resolveDatabaseUrl } from "./lib/db/connection-url";

config({
  path: ".env.local",
});

export default defineConfig({
  dbCredentials: {
    url: resolveDatabaseUrl(
      process.env.POSTGRES_URL ?? "",
      process.env.GRACE_SUPABASE_POOLER_HOST
    ),
  },
  dialect: "postgresql",
  out: "./lib/db/migrations",
  schema: "./lib/db/schema.ts",
});
