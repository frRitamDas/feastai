import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Versioned envelope. The credential's immutable database ID is authenticated
 * as associated data so ciphertext cannot be copied between credential rows. */
export type EncryptedCredential = {
  version: 1;
  iv: string;
  ciphertext: string;
  tag: string;
};

/** Only a canonical base64 encoding of exactly 32 bytes can be used as a key. */
export function isValidCredentialKey(
  encodedKey: string | undefined
): encodedKey is string {
  if (!encodedKey || !/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) {
    return false;
  }
  const key = Buffer.from(encodedKey, "base64");
  return key.length === 32 && key.toString("base64") === encodedKey;
}

function getKey(encodedKey: string | undefined): Buffer {
  if (!isValidCredentialKey(encodedKey)) {
    throw new Error("Credential encryption is not configured correctly");
  }
  return Buffer.from(encodedKey, "base64");
}

export function encryptCredential(
  plaintext: string,
  credentialId: string,
  encodedKey: string | undefined
): EncryptedCredential {
  if (!plaintext || !credentialId) {
    throw new Error("Credential and identifier are required");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(encodedKey), iv);
  cipher.setAAD(Buffer.from(credentialId, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    version: 1,
  };
}

export function decryptCredential(
  value: EncryptedCredential | string,
  credentialId: string,
  encodedKey: string | undefined
): string {
  // Older server versions stored the JSON envelope as a JSONB string.
  let envelope = value;
  if (typeof envelope === "string") {
    try {
      envelope = JSON.parse(envelope) as EncryptedCredential;
    } catch {
      // biome-ignore lint/style/useErrorCause: JSON parser errors can include credential data.
      throw new Error("Invalid credential envelope");
    }
  }
  if (
    !envelope ||
    typeof envelope !== "object" ||
    envelope.version !== 1 ||
    !credentialId
  ) {
    throw new Error("Unsupported credential envelope");
  }
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error("Invalid credential envelope");
  }
  const decipher = createDecipheriv("aes-256-gcm", getKey(encodedKey), iv);
  decipher.setAAD(Buffer.from(credentialId, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
