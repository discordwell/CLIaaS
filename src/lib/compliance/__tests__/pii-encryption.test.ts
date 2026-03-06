import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { encryptPii, decryptPii, hashPii, isPiiEncryptionConfigured } from '../pii-encryption';

describe('PII Encryption', () => {
  const TEST_KEY = 'a'.repeat(64); // 32 bytes hex

  beforeEach(() => {
    process.env.PII_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.PII_ENCRYPTION_KEY;
  });

  describe('encryptPii / decryptPii', () => {
    it('round-trips plaintext through encrypt/decrypt', () => {
      const plaintext = '123-45-6789';
      const encrypted = encryptPii(plaintext);
      expect(encrypted).not.toBeNull();
      expect(encrypted).toBeInstanceOf(Buffer);

      const decrypted = decryptPii(encrypted!);
      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertexts for same plaintext (random IV)', () => {
      const plaintext = 'sensitive-data';
      const enc1 = encryptPii(plaintext);
      const enc2 = encryptPii(plaintext);
      expect(enc1).not.toBeNull();
      expect(enc2).not.toBeNull();
      expect(enc1!.equals(enc2!)).toBe(false);
    });

    it('returns null when key not configured', () => {
      delete process.env.PII_ENCRYPTION_KEY;
      expect(encryptPii('test')).toBeNull();
      expect(decryptPii(Buffer.from('test'))).toBeNull();
    });

    it('returns null for corrupted ciphertext', () => {
      const encrypted = encryptPii('test')!;
      // Corrupt the auth tag
      encrypted[15] ^= 0xff;
      const result = decryptPii(encrypted);
      expect(result).toBeNull();
    });
  });

  describe('hashPii', () => {
    it('produces consistent SHA-256 hash', () => {
      const hash1 = hashPii('123-45-6789');
      const hash2 = hashPii('123-45-6789');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // hex-encoded SHA-256
    });

    it('produces different hashes for different inputs', () => {
      expect(hashPii('a')).not.toBe(hashPii('b'));
    });
  });

  describe('isPiiEncryptionConfigured', () => {
    it('returns true when key is set', () => {
      expect(isPiiEncryptionConfigured()).toBe(true);
    });

    it('returns false when key is not set', () => {
      delete process.env.PII_ENCRYPTION_KEY;
      expect(isPiiEncryptionConfigured()).toBe(false);
    });

    it('returns false when key has wrong length', () => {
      process.env.PII_ENCRYPTION_KEY = 'abcd'; // Only 2 bytes, not 32
      expect(isPiiEncryptionConfigured()).toBe(false);
    });

    it('rejects encryption with wrong-length key', () => {
      process.env.PII_ENCRYPTION_KEY = 'ff'.repeat(16); // 16 bytes, not 32
      expect(encryptPii('test')).toBeNull();
    });
  });
});
