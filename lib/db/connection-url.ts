/**
 * Optionally route a direct Supabase Postgres URL through its session pooler.
 * This preserves credentials without exposing or copying them. The pooler host
 * is restricted to Supabase's AWS pooler domain, so a typo cannot send the
 * database password to an arbitrary host. A pooled URL remains unchanged.
 */
export function resolveDatabaseUrl(url: string, poolerHost?: string): string {
  if (!poolerHost) {
    return url;
  }
  if (
    !/^aws-[0-9]+-[a-z]{2}-[a-z]+-[0-9]+\.pooler\.supabase\.com$/.test(
      poolerHost
    )
  ) {
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
  connection.port = "5432"; // Session pooling supports prepared statements.
  connection.username = `${decodeURIComponent(connection.username)}.${direct[1]}`;
  // The certificate-verified mode is probed separately before it is enabled.
  connection.searchParams.set("sslmode", "require");
  return connection.toString();
}
