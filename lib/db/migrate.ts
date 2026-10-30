import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { resolveDatabaseUrl, supabasePoolerOptions } from "./connection-url";

config({
  path: ".env.local",
});

const runMigrate = async () => {
  if (!process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL is required to run migrations");
    process.exit(1);
  }

  const databaseUrl = resolveDatabaseUrl(
    process.env.POSTGRES_URL,
    process.env.GRACE_SUPABASE_POOLER_HOST
  );
  const connection = postgres(databaseUrl, {
    max: 1,
    ...supabasePoolerOptions(databaseUrl),
  });
  const db = drizzle(connection);

  console.log("Running migrations...");

  const start = Date.now();
  await migrate(db, { migrationsFolder: "./lib/db/migrations" });
  const end = Date.now();

  console.log("Migrations completed in", end - start, "ms");
  process.exit(0);
};

runMigrate().catch((err) => {
  console.error("Migration failed");
  console.error(err);
  process.exit(1);
});
