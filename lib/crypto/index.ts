/**
 * Encryption helpers for sensitive values (Azure client secrets).
 * Uses AES-256-CBC with a key from env.
 * Swap the two exported functions to use Azure Key Vault without changing callers.
 */
import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const KEY_HEX = process.env.SECRET_ENCRYPTION_KEY ?? "";
const IV_LENGTH = 16; // 128-bit IV

function getKey(): Buffer {
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). " +
        "Generate one with: openssl rand -hex 32"
    );
  }
  return Buffer.from(KEY_HEX, "hex");
}

/**
 * Encrypt a plaintext string.
 * Returns "iv:ciphertext" as a hex-encoded string.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a value produced by encrypt().
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const [ivHex, encHex] = ciphertext.split(":");
  if (!ivHex || !encHex) {
    throw new Error("Invalid ciphertext format");
  }
  const iv = Buffer.from(ivHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(enc), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Encrypt a JSON-serialisable object (used for CloudCredential.credentialData).
 */
export function encryptJson<T>(obj: T): string {
  return encrypt(JSON.stringify(obj));
}

/**
 * Decrypt a value produced by encryptJson() and parse it back to T.
 */
export function decryptJson<T>(ciphertext: string): T {
  return JSON.parse(decrypt(ciphertext)) as T;
}
