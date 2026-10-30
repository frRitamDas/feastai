import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 600;
function signature(payload: string, secret: string, version: string) {
  return createHmac("sha256", secret)
    .update(`grace-admin-v1:${version}:${payload}`)
    .digest("base64url");
}
export function createAdminProof(
  userId: string,
  secret: string,
  version: string,
  now = Date.now()
): string {
  if (secret.length < 32) {
    throw new Error("Missing authentication secret");
  }
  const payload = `${userId}.${Math.floor(now / 1000) + MAX_AGE_SECONDS}`;
  return `${payload}.${signature(payload, secret, version)}`;
}
export function verifyAdminProof(
  value: string | undefined,
  userId: string,
  secret: string | undefined,
  version: string,
  now = Date.now()
): boolean {
  if (!value || !secret || secret.length < 32 || value.length > 256) {
    return false;
  }
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== userId || !/^\d+$/.test(parts[1])) {
    return false;
  }
  const expiration = Number(parts[1]);
  const current = Math.floor(now / 1000);
  if (
    !Number.isSafeInteger(expiration) ||
    expiration <= current ||
    expiration > current + MAX_AGE_SECONDS
  ) {
    return false;
  }
  const actual = Buffer.from(parts[2]);
  const expected = Buffer.from(
    signature(`${parts[0]}.${parts[1]}`, secret, version)
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
