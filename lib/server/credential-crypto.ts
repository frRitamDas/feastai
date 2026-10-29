import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Versioned envelope. The credential's immutable database ID is authenticated
 * as associated data so ciphertext cannot be copied between credential rows. */
export type EncryptedCredential = {
  version: 1;
  iv: string;
  ciphertext: string;
  tag: string;
};

function getKey(encodedKey: string | undefined): Buffer {
  if (!encodedKey || !/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) {
    throw new Error("Credential encryption is not configured correctly");
  }
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== encodedKey) {
    throw new Error("Credential encryption is not configured correctly");
  }
  return key;
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
  envelope: EncryptedCredential,
  credentialId: string,
  encodedKey: string | undefined
): string {
  if (envelope.version !== 1 || !credentialId) {
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
