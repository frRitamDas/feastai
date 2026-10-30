// Auth.js re-encrypts its JWT on a session refresh and issues a new `jti`.
// Preserve a separate random per-login identifier across those refreshes.
// For pre-upgrade JWTs, the original Auth.js `jti` is the initial identifier;
// the JWT callback copies it into the persistent claim on the next refresh.
const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sessionBinding(claims: {
  graceSessionBinding?: unknown;
  jti?: unknown;
}): string | null {
  const candidate = claims.graceSessionBinding ?? claims.jti;
  return typeof candidate === "string" && SESSION_ID.test(candidate)
    ? candidate
    : null;
}
