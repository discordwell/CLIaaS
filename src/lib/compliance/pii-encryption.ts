/**
 * PII encryption utilities — AES-256-GCM for encrypting original PII values
 * before storage, and SHA-256 hashing for the immutable redaction log.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.PII_ENCRYPTION_KEY;
  if (!keyHex) return null;
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) return null; // AES-256 requires exactly 32 bytes
  return key;
}

/**
 * Encrypt a PII value with AES-256-GCM.
 * Returns IV (12 bytes) + authTag (16 bytes) + ciphertext concatenated.
 * Returns null if PII_ENCRYPTION_KEY is not configured.
 */
export function encryptPii(plaintext: string): Buffer | null {
  const key = getEncryptionKey();
  if (!key) return null;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt a PII value previously encrypted with encryptPii.
 * Input format: IV (12 bytes) + authTag (16 bytes) + ciphertext.
 * Returns null if PII_ENCRYPTION_KEY is not configured or decryption fails.
 */
export function decryptPii(ciphertext: Buffer): string | null {
  const key = getEncryptionKey();
  if (!key) return null;

  try {
    const iv = ciphertext.subarray(0, IV_LENGTH);
    const authTag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = ciphertext.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/** SHA-256 hash of a PII value (for the immutable redaction log). */
export function hashPii(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** Check whether PII encryption is configured. */
export function isPiiEncryptionConfigured(): boolean {
  return getEncryptionKey() !== null;
}
