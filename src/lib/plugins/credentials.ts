/**
 * Plugin credential encryption/decryption using AES-256-GCM.
 * Credentials are encrypted at rest and decrypted only when needed.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Derive the encryption key from env or DATABASE_URL.
 * Returns a 32-byte key suitable for AES-256.
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.PLUGIN_ENCRYPTION_KEY;
  if (envKey) {
    // If the env key is 64 hex chars (32 bytes), use directly
    if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
      return Buffer.from(envKey, 'hex');
    }
    // Otherwise hash it to get a consistent 32-byte key
    return createHash('sha256').update(envKey).digest();
  }

  // Fallback: derive from DATABASE_URL
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    return createHash('sha256').update(`cliaas-plugin-creds:${dbUrl}`).digest();
  }

  // Last resort: deterministic key (development only)
  return createHash('sha256').update('cliaas-plugin-dev-key').digest();
}

/**
 * Encrypt a credentials object. Returns a base64-encoded string containing
 * IV + ciphertext + auth tag.
 */
export function encryptCredentials(data: Record<string, string>): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack as: IV (12 bytes) + authTag (16 bytes) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt a credentials string back to the original object.
 */
export function decryptCredentials(encrypted: string): Record<string, string> {
  const key = getEncryptionKey();
  const packed = Buffer.from(encrypted, 'base64');

  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted credentials: data too short');
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}
