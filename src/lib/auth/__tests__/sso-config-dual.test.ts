import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';

const TEST_DIR = '/tmp/cliaas-test-sso-dual-' + process.pid;

describe('SSO config dual-mode (JSONL path)', () => {
  beforeEach(() => {
    process.env.CLIAAS_DATA_DIR = TEST_DIR;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    // Reset globals
    const g = globalThis as Record<string, unknown>;
    g.__cliaasSSO = undefined;
    g.__cliaasSSO_loaded = undefined;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    delete process.env.CLIAAS_DATA_DIR;
    const g = globalThis as Record<string, unknown>;
    g.__cliaasSSO = undefined;
    g.__cliaasSSO_loaded = undefined;
  });

  // ---- CRUD (sync path) ----

  describe('createProvider', () => {
    it('creates a SAML provider with generated id and timestamps', async () => {
      const { createProvider } = await import('../sso-config');
      const provider = createProvider({
        name: 'Okta SAML',
        protocol: 'saml' as const,
        enabled: true,
        entityId: 'https://okta.example.com/entity',
        ssoUrl: 'https://okta.example.com/sso',
        certificate: 'MIID...',
        domainHint: 'example.com',
      });
      expect(provider.id).toMatch(/^sso-/);
      expect(provider.name).toBe('Okta SAML');
      expect(provider.protocol).toBe('saml');
      expect(provider.enabled).toBe(true);
      expect(provider.entityId).toBe('https://okta.example.com/entity');
      expect(provider.createdAt).toBeTruthy();
      expect(provider.updatedAt).toBeTruthy();
    });

    it('creates an OIDC provider', async () => {
      const { createProvider } = await import('../sso-config');
      const provider = createProvider({
        name: 'Azure OIDC',
        protocol: 'oidc' as const,
        enabled: true,
        clientId: 'client-123',
        clientSecret: 'secret-456',
        issuer: 'https://login.microsoftonline.com/tenant',
        authorizationUrl: 'https://login.microsoftonline.com/tenant/authorize',
        tokenUrl: 'https://login.microsoftonline.com/tenant/token',
        userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
      });
      expect(provider.protocol).toBe('oidc');
      expect(provider.clientId).toBe('client-123');
      expect(provider.issuer).toBe('https://login.microsoftonline.com/tenant');
    });
  });

  describe('getProviders', () => {
    it('returns empty array initially', async () => {
      const { getProviders } = await import('../sso-config');
      expect(getProviders()).toEqual([]);
    });

    it('returns all created providers', async () => {
      const { createProvider, getProviders } = await import('../sso-config');
      createProvider({ name: 'P1', protocol: 'saml' as const, enabled: true, certificate: 'MIICtest' });
      createProvider({ name: 'P2', protocol: 'oidc' as const, enabled: false });
      const providers = getProviders();
      expect(providers).toHaveLength(2);
      expect(providers.map((p: { name: string }) => p.name).sort()).toEqual(['P1', 'P2']);
    });
  });

  describe('getProvider', () => {
    it('retrieves a provider by id', async () => {
      const { createProvider, getProvider } = await import('../sso-config');
      const created = createProvider({
        name: 'Test Provider',
        protocol: 'saml' as const,
        enabled: true,
        certificate: 'MIICtest',
      });
      const fetched = getProvider(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe('Test Provider');
    });

    it('returns undefined for nonexistent id', async () => {
      const { getProvider } = await import('../sso-config');
      expect(getProvider('nonexistent-id')).toBeUndefined();
    });
  });

  describe('updateProvider', () => {
    it('modifies fields and updates timestamp', async () => {
      const { createProvider, updateProvider } = await import('../sso-config');
      const created = createProvider({
        name: 'Original',
        protocol: 'saml' as const,
        enabled: true,
        certificate: 'MIICtest',
      });
      await new Promise(r => setTimeout(r, 5));
      const updated = updateProvider(created.id, { name: 'Renamed', enabled: false });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Renamed');
      expect(updated!.enabled).toBe(false);
      expect(updated!.protocol).toBe('saml'); // unchanged
      expect(updated!.updatedAt).not.toBe(created.updatedAt);
    });

    it('returns null for nonexistent id', async () => {
      const { updateProvider } = await import('../sso-config');
      expect(updateProvider('nonexistent', { name: 'Nope' })).toBeNull();
    });
  });

  describe('deleteProvider', () => {
    it('removes a provider and returns true', async () => {
      const { createProvider, deleteProvider, getProvider } = await import('../sso-config');
      const created = createProvider({ name: 'Delete Me', protocol: 'oidc' as const, enabled: false });
      expect(deleteProvider(created.id)).toBe(true);
      expect(getProvider(created.id)).toBeUndefined();
    });

    it('returns false for nonexistent id', async () => {
      const { deleteProvider } = await import('../sso-config');
      expect(deleteProvider('nonexistent')).toBe(false);
    });
  });

  describe('findByDomain', () => {
    it('finds an enabled provider by domainHint', async () => {
      const { createProvider, findByDomain } = await import('../sso-config');
      createProvider({
        name: 'Acme SSO',
        protocol: 'saml' as const,
        enabled: true,
        domainHint: 'acme.com',
        certificate: 'MIICtest',
      });
      createProvider({
        name: 'Other SSO',
        protocol: 'oidc' as const,
        enabled: true,
        domainHint: 'other.com',
      });
      const found = findByDomain('acme.com');
      expect(found).toBeDefined();
      expect(found!.name).toBe('Acme SSO');
    });

    it('does not match disabled providers', async () => {
      const { createProvider, findByDomain } = await import('../sso-config');
      createProvider({
        name: 'Disabled SSO',
        protocol: 'saml' as const,
        enabled: false,
        domainHint: 'disabled.com',
        certificate: 'MIICtest',
      });
      expect(findByDomain('disabled.com')).toBeUndefined();
    });

    it('returns undefined when no matching domain', async () => {
      const { findByDomain } = await import('../sso-config');
      expect(findByDomain('unknown.com')).toBeUndefined();
    });
  });

  // ---- JSONL Persistence ----

  describe('JSONL persistence', () => {
    it('data survives global reset and re-import', async () => {
      const mod1 = await import('../sso-config');
      const created = mod1.createProvider({
        name: 'Persistent Provider',
        protocol: 'saml' as const,
        enabled: true,
        domainHint: 'persist.com',
        forceAuthn: true,
        signedAssertions: true,
        defaultRole: 'agent',
        certificate: 'MIICtest',
      });

      // Reset globals to simulate fresh process
      const g = globalThis as Record<string, unknown>;
      g.__cliaasSSO = undefined;
      g.__cliaasSSO_loaded = undefined;

      // Re-import loads from JSONL on disk
      const mod2 = await import('../sso-config');
      const fetched = mod2.getProvider(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe('Persistent Provider');
      expect(fetched!.domainHint).toBe('persist.com');
    });

    it('multiple providers persist and reload correctly', async () => {
      const mod1 = await import('../sso-config');
      mod1.createProvider({ name: 'P1', protocol: 'saml' as const, enabled: true, certificate: 'MIICtest' });
      mod1.createProvider({ name: 'P2', protocol: 'oidc' as const, enabled: false });
      mod1.createProvider({ name: 'P3', protocol: 'saml' as const, enabled: true, certificate: 'MIICtest' });

      // Reset globals
      const g = globalThis as Record<string, unknown>;
      g.__cliaasSSO = undefined;
      g.__cliaasSSO_loaded = undefined;

      const mod2 = await import('../sso-config');
      const providers = mod2.getProviders();
      expect(providers).toHaveLength(3);
      expect(providers.map((p: { name: string }) => p.name).sort()).toEqual(['P1', 'P2', 'P3']);
    });
  });

  // ---- New SSOProvider fields ----

  describe('new SSOProvider fields', () => {
    it('forceAuthn is stored and retrieved', async () => {
      const { createProvider, getProvider } = await import('../sso-config');
      const created = createProvider({
        name: 'ForceAuthn Test',
        protocol: 'saml' as const,
        enabled: true,
        forceAuthn: true,
        certificate: 'MIICtest',
      });
      const fetched = getProvider(created.id);
      expect(fetched!.forceAuthn).toBe(true);
    });

    it('signedAssertions is stored and retrieved', async () => {
      const { createProvider, getProvider } = await import('../sso-config');
      const created = createProvider({
        name: 'SignedAssertions Test',
        protocol: 'saml' as const,
        enabled: true,
        signedAssertions: true,
        certificate: 'MIICtest',
      });
      const fetched = getProvider(created.id);
      expect(fetched!.signedAssertions).toBe(true);
    });

    it('defaultRole is stored and retrieved', async () => {
      const { createProvider, getProvider } = await import('../sso-config');
      const created = createProvider({
        name: 'DefaultRole Test',
        protocol: 'oidc' as const,
        enabled: true,
        defaultRole: 'viewer',
      });
      const fetched = getProvider(created.id);
      expect(fetched!.defaultRole).toBe('viewer');
    });

    it('new fields can be updated', async () => {
      const { createProvider, updateProvider } = await import('../sso-config');
      const created = createProvider({
        name: 'Update Fields Test',
        protocol: 'saml' as const,
        enabled: true,
        forceAuthn: false,
        signedAssertions: false,
        defaultRole: 'agent',
        certificate: 'MIICtest',
      });
      await new Promise(r => setTimeout(r, 5));
      const updated = updateProvider(created.id, {
        forceAuthn: true,
        signedAssertions: true,
        defaultRole: 'admin',
      });
      expect(updated!.forceAuthn).toBe(true);
      expect(updated!.signedAssertions).toBe(true);
      expect(updated!.defaultRole).toBe('admin');
    });

    it('new fields persist through JSONL round-trip', async () => {
      const mod1 = await import('../sso-config');
      const created = mod1.createProvider({
        name: 'Persist Fields',
        protocol: 'saml' as const,
        enabled: true,
        forceAuthn: true,
        signedAssertions: true,
        defaultRole: 'supervisor',
        certificate: 'MIICtest',
      });

      // Reset globals
      const g = globalThis as Record<string, unknown>;
      g.__cliaasSSO = undefined;
      g.__cliaasSSO_loaded = undefined;

      const mod2 = await import('../sso-config');
      const fetched = mod2.getProvider(created.id);
      expect(fetched!.forceAuthn).toBe(true);
      expect(fetched!.signedAssertions).toBe(true);
      expect(fetched!.defaultRole).toBe('supervisor');
    });
  });
});
