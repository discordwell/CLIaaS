import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, rmSync } from 'fs';

const TEST_DIR = '/tmp/cliaas-sso-test-' + process.pid;

describe('sso-config', () => {
  beforeEach(async () => {
    // Reset globals and JSONL dir
    process.env.CLIAAS_DATA_DIR = TEST_DIR;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });

    const g = globalThis as Record<string, unknown>;
    g.__cliaasSSO = undefined;
    g.__cliaasSSO_loaded = undefined;
  });

  it('createProvider and getProvider round-trip', async () => {
    // Dynamic import to pick up fresh globals
    const mod = await import('@/lib/auth/sso-config');
    const created = mod.createProvider({
      name: 'Test SAML',
      protocol: 'saml',
      enabled: true,
      entityId: 'https://idp.test.com',
      ssoUrl: 'https://idp.test.com/sso',
    });
    expect(created.id).toBeTruthy();
    expect(created.name).toBe('Test SAML');
    const fetched = mod.getProvider(created.id);
    expect(fetched?.name).toBe('Test SAML');
  });

  it('getProviders returns all providers', async () => {
    const mod = await import('@/lib/auth/sso-config');
    const initial = mod.getProviders();
    // Should have demo providers seeded
    expect(initial.length).toBeGreaterThanOrEqual(2);
  });

  it('updateProvider modifies fields', async () => {
    const mod = await import('@/lib/auth/sso-config');
    const providers = mod.getProviders();
    const first = providers[0];
    const updated = mod.updateProvider(first.id, { name: 'Renamed' });
    expect(updated?.name).toBe('Renamed');
    expect(updated?.updatedAt).not.toBe(first.updatedAt);
  });

  it('deleteProvider removes provider', async () => {
    const mod = await import('@/lib/auth/sso-config');
    const created = mod.createProvider({
      name: 'Delete Me',
      protocol: 'oidc',
      enabled: false,
    });
    expect(mod.getProvider(created.id)).toBeDefined();
    const deleted = mod.deleteProvider(created.id);
    expect(deleted).toBe(true);
    expect(mod.getProvider(created.id)).toBeUndefined();
  });

  it('deleteProvider returns false for nonexistent id', async () => {
    const mod = await import('@/lib/auth/sso-config');
    mod.getProviders(); // seed
    expect(mod.deleteProvider('nonexistent')).toBe(false);
  });
});
