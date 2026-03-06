/**
 * Tests for plugin credential encryption/decryption
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Plugin Credentials', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('encrypts and decrypts credentials correctly', async () => {
    process.env.PLUGIN_ENCRYPTION_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes
    const { encryptCredentials, decryptCredentials } = await import('@/lib/plugins/credentials');

    const original = {
      api_key: 'sk-test-1234567890',
      webhook_secret: 'whsec_abcdef',
    };

    const encrypted = encryptCredentials(original);
    expect(typeof encrypted).toBe('string');
    expect(encrypted).not.toContain('sk-test');

    const decrypted = decryptCredentials(encrypted);
    expect(decrypted).toEqual(original);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', async () => {
    process.env.PLUGIN_ENCRYPTION_KEY = 'b'.repeat(64);
    const { encryptCredentials } = await import('@/lib/plugins/credentials');

    const data = { key: 'value' };
    const enc1 = encryptCredentials(data);
    const enc2 = encryptCredentials(data);

    expect(enc1).not.toBe(enc2); // Different IVs should produce different outputs
  });

  it('fails to decrypt with wrong key', async () => {
    process.env.PLUGIN_ENCRYPTION_KEY = 'c'.repeat(64);
    const mod1 = await import('@/lib/plugins/credentials');
    const encrypted = mod1.encryptCredentials({ secret: 'hello' });

    // Change the key
    process.env.PLUGIN_ENCRYPTION_KEY = 'd'.repeat(64);
    vi.resetModules();
    const mod2 = await import('@/lib/plugins/credentials');

    expect(() => mod2.decryptCredentials(encrypted)).toThrow();
  });

  it('uses DATABASE_URL as fallback key source', async () => {
    delete process.env.PLUGIN_ENCRYPTION_KEY;
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
    const { encryptCredentials, decryptCredentials } = await import('@/lib/plugins/credentials');

    const original = { token: 'my-secret-token' };
    const encrypted = encryptCredentials(original);
    const decrypted = decryptCredentials(encrypted);

    expect(decrypted).toEqual(original);
  });

  it('uses dev fallback key when no env vars are set', async () => {
    delete process.env.PLUGIN_ENCRYPTION_KEY;
    delete process.env.DATABASE_URL;
    const { encryptCredentials, decryptCredentials } = await import('@/lib/plugins/credentials');

    const original = { api: 'dev-key' };
    const encrypted = encryptCredentials(original);
    const decrypted = decryptCredentials(encrypted);

    expect(decrypted).toEqual(original);
  });

  it('handles non-hex PLUGIN_ENCRYPTION_KEY by hashing it', async () => {
    process.env.PLUGIN_ENCRYPTION_KEY = 'my-human-readable-passphrase';
    const { encryptCredentials, decryptCredentials } = await import('@/lib/plugins/credentials');

    const original = { password: 'secret123' };
    const encrypted = encryptCredentials(original);
    const decrypted = decryptCredentials(encrypted);

    expect(decrypted).toEqual(original);
  });

  it('throws on invalid encrypted data (too short)', async () => {
    process.env.PLUGIN_ENCRYPTION_KEY = 'e'.repeat(64);
    const { decryptCredentials } = await import('@/lib/plugins/credentials');

    expect(() => decryptCredentials('dG9vc2hvcnQ=')).toThrow('Invalid encrypted credentials');
  });

  it('handles empty credentials object', async () => {
    process.env.PLUGIN_ENCRYPTION_KEY = 'f'.repeat(64);
    const { encryptCredentials, decryptCredentials } = await import('@/lib/plugins/credentials');

    const encrypted = encryptCredentials({});
    const decrypted = decryptCredentials(encrypted);
    expect(decrypted).toEqual({});
  });
});
