import { createHmac, timingSafeEqual } from "node:crypto";

export function decodeBase32(input: string): Buffer {
  const value = input.replace(/\s/g, "").toUpperCase().replace(/[=]+$/, "");
  if (!/^[A-Z2-7]{16,128}$/.test(value)) {
    throw new Error("Invalid TOTP secret");
  }
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of value) {
    buffer = (buffer << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counter)
    .digest();
  const offset = (digest.at(-1) ?? 0) & 15;
  const value = (digest.readUInt32BE(offset) & 0x7f_ff_ff_ff) % 1_000_000;
  return String(value).padStart(6, "0");
}

/** Return the matching time step so the database can atomically reject reuse. */
export function verifyTotp(
  secret: string,
  code: string,
  now = Date.now()
): number | null {
  if (!/^\d{6}$/.test(code)) {
    return null;
  }
  const current = Math.floor(now / 30_000);
  for (const step of [current - 1, current, current + 1]) {
    if (step < 0) {
      continue;
    }
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) {
      return step;
    }
  }
  return null;
}
