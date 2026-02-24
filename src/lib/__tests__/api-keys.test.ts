import { describe, it, expect } from 'vitest';
import { generateApiKey } from '@/lib/api-keys';

describe('API keys service', () => {
  describe('generateApiKey', () => {
    it('generates a key with cliaas_ prefix', () => {
      const { rawKey, keyHash, prefix } = generateApiKey();
      expect(rawKey).toMatch(/^cliaas_[a-f0-9]{8}_[a-f0-9]+$/);
      expect(prefix).toMatch(/^cliaas_[a-f0-9]{8}$/);
      expect(keyHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    });

    it('generates unique keys each time', () => {
      const k1 = generateApiKey();
      const k2 = generateApiKey();
      expect(k1.rawKey).not.toBe(k2.rawKey);
      expect(k1.keyHash).not.toBe(k2.keyHash);
    });

    it('produces deterministic hash from key', () => {
      const { rawKey, keyHash } = generateApiKey();
      // Verify by hashing again
      const crypto = require('crypto');
      const reHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      expect(reHash).toBe(keyHash);
    });

    it('prefix matches the beginning of the raw key', () => {
      const { rawKey, prefix } = generateApiKey();
      expect(rawKey.startsWith(prefix)).toBe(true);
    });
  });
});
