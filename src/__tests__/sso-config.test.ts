import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('SSO Config', () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset the global SSO state between tests
    const g = globalThis as unknown as {
      __cliaasSSO?: unknown[];
      __cliaasSSO_loaded?: boolean;
    };
    delete g.__cliaasSSO;
    delete g.__cliaasSSO_loaded;
  });

  it('returns no providers on fresh init (no demo providers)', async () => {
    // Mock the JSONL store to return nothing saved
    vi.doMock('@/lib/jsonl-store', () => ({
      readJsonlFile: vi.fn().mockReturnValue([]),
      writeJsonlFile: vi.fn(),
    }));

    const { getProviders } = await import('@/lib/auth/sso-config');
    const providers = getProviders();
    expect(providers).toEqual([]);
  });

  it('loads persisted providers from JSONL', async () => {
    const saved = [
      {
        id: 'sso-custom',
        name: 'Custom SAML',
        protocol: 'saml',
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    vi.doMock('@/lib/jsonl-store', () => ({
      readJsonlFile: vi.fn().mockReturnValue(saved),
      writeJsonlFile: vi.fn(),
    }));

    const { getProviders } = await import('@/lib/auth/sso-config');
    const providers = getProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe('Custom SAML');
  });

  it('does not contain Acme Corp or Globex demo providers', async () => {
    vi.doMock('@/lib/jsonl-store', () => ({
      readJsonlFile: vi.fn().mockReturnValue([]),
      writeJsonlFile: vi.fn(),
    }));

    const { getProviders } = await import('@/lib/auth/sso-config');
    const providers = getProviders();
    const names = providers.map((p) => p.name);
    expect(names).not.toContain('Acme Corp SAML');
    expect(names).not.toContain('Globex OIDC');
  });
});
