/**
 * TOTP (Time-based One-Time Password) implementation.
 *
 * Uses Node's crypto module — no external dependencies.
 * Implements RFC 6238 (TOTP) with RFC 4226 (HOTP) as the base.
 */

import { randomBytes, createHmac, createCipheriv, createDecipheriv } from 'crypto';

const TOTP_PERIOD = 30; // seconds
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = 'sha1';
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;

// ---- Base32 encoding/decoding ----

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Buffer): string {
  let bits = '';
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    result += BASE32_CHARS[parseInt(chunk, 2)];
  }
  return result;
}

function base32Decode(encoded: string): Buffer {
  let bits = '';
  for (const char of encoded.toUpperCase()) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// ---- HOTP/TOTP core ----

function hotp(secret: Buffer, counter: bigint): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);

  const hmac = createHmac(TOTP_ALGORITHM, secret);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  return (code % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}

function getCurrentCounter(time?: number): bigint {
  const seconds = time ?? Math.floor(Date.now() / 1000);
  return BigInt(Math.floor(seconds / TOTP_PERIOD));
}

// ---- Public API ----

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  return base32Encode(bytes);
}

export function generateTotpUrl(secret: string, email: string): string {
  const issuer = 'CLIaaS';
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(email);
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}

/**
 * Verify a TOTP code against a secret.
 * Checks the current time step and ±1 step (±30s window) to handle clock skew.
 */
export function verifyTotp(secret: string, code: string, time?: number): boolean {
  if (!code || code.length !== TOTP_DIGITS) return false;

  const secretBuffer = base32Decode(secret);
  const counter = getCurrentCounter(time);

  // Check current step and ±1 for clock skew tolerance
  for (let i = -1; i <= 1; i++) {
    const expected = hotp(secretBuffer, counter + BigInt(i));
    if (timingSafeEqual(code, expected)) return true;
  }

  return false;
}

/** Constant-time string comparison to prevent timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---- Backup Codes ----

export interface BackupCode {
  code: string;
  usedAt: string | null;
}

export function generateBackupCodes(count: number = BACKUP_CODE_COUNT): BackupCode[] {
  const codes: BackupCode[] = [];
  for (let i = 0; i < count; i++) {
    const code = randomBytes(4).toString('hex').toUpperCase().slice(0, BACKUP_CODE_LENGTH);
    codes.push({ code, usedAt: null });
  }
  return codes;
}

export function verifyBackupCode(codes: BackupCode[], input: string): { valid: boolean; updatedCodes: BackupCode[] } {
  const normalized = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const updatedCodes = [...codes];

  for (let i = 0; i < updatedCodes.length; i++) {
    if (updatedCodes[i].usedAt === null && timingSafeEqual(updatedCodes[i].code, normalized)) {
      updatedCodes[i] = { ...updatedCodes[i], usedAt: new Date().toISOString() };
      return { valid: true, updatedCodes };
    }
  }

  return { valid: false, updatedCodes: codes };
}

// ---- Secret Encryption (AES-256-GCM) ----

function getEncryptionKey(): Buffer {
  const key = process.env.MFA_ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MFA_ENCRYPTION_KEY environment variable is required in production');
    }
    // Dev fallback — deterministic key for local development
    return Buffer.from('cliaas-dev-mfa-key-change-in-prod'.padEnd(32, '0').slice(0, 32));
  }
  // Accept hex-encoded 32-byte key
  if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
    return Buffer.from(key, 'hex');
  }
  // Accept raw string (padded/truncated to 32 bytes)
  return Buffer.from(key.padEnd(32, '0').slice(0, 32));
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decryptSecret(encrypted: string): string {
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');

  const [ivHex, authTagHex, ciphertext] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
