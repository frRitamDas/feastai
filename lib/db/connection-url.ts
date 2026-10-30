import { SUPABASE_ROOT_CA_2021 } from "./supabase-ca";

const SUPABASE_POOLER_HOST =
  /^aws-[0-9]+-[a-z]{2}-[a-z]+-[0-9]+\.pooler\.supabase\.com$/;

/**
 * Optionally route a direct Supabase Postgres URL through its transaction pooler.
 * This preserves credentials without exposing or copying them. The pooler host
 * is restricted to Supabase's AWS pooler domain, so a typo cannot send the
 * database password to an arbitrary host. A pooled URL remains unchanged.
 */
export function resolveDatabaseUrl(url: string, poolerHost?: string): string {
  if (!poolerHost) {
    return url;
  }
  if (!SUPABASE_POOLER_HOST.test(poolerHost)) {
    throw new Error("Invalid Supabase pooler host");
  }
  let connection: URL;
  try {
    connection = new URL(url);
  } catch {
    // biome-ignore lint/style/useErrorCause: URL parser errors may contain credentials.
    throw new Error("Invalid PostgreSQL connection URL");
  }
  if (!["postgres:", "postgresql:"].includes(connection.protocol)) {
    throw new Error("Invalid PostgreSQL connection URL");
  }
  if (connection.hostname === poolerHost) {
    return url;
  }
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(connection.hostname);
  if (!(direct && connection.username)) {
    throw new Error("Expected a direct Supabase PostgreSQL URL");
  }
  connection.hostname = poolerHost;
  connection.port = "6543"; // Transaction pooling is suited to serverless.
  connection.username = `${decodeURIComponent(connection.username)}.${direct[1]}`;
  connection.searchParams.set("sslmode", "verify-full");
  return connection.toString();
}

/** Pooler connections authenticate the host with Supabase's public root CA.
 * Explicit options override SSL flags in the URL in postgres.js. Named prepared
 * statements and pipelining are incompatible with transaction pooling. */
export function supabasePoolerOptions(url: string): {
  max_pipeline?: number;
  prepare?: boolean;
  ssl?: { ca: string; rejectUnauthorized: true };
} {
  let connection: URL;
  try {
    connection = new URL(url);
  } catch {
    return {};
  }
  if (
    !["postgres:", "postgresql:"].includes(connection.protocol) ||
    !SUPABASE_POOLER_HOST.test(connection.hostname)
  ) {
    return {};
  }
  return {
    ...(connection.port === "6543" ? { max_pipeline: 1, prepare: false } : {}),
    ssl: { ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true },
  };
}
