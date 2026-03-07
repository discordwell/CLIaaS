import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests for JIT (Just-In-Time) provisioning in SSO login.
 *
 * These run in demo mode (no DATABASE_URL) so we can test the JIT logic
 * without a real database. The provider lookup is mocked via sso-config.
 */

// Mock the auth module to capture createToken calls
vi.mock('@/lib/auth', () => ({
  createToken: vi.fn(async (user: Record<string, unknown>) => `mock-jwt-${user.role}-${user.email}`),
}));

// We'll control what getProviderAsync returns per test
const mockGetProviderAsync = vi.fn();
vi.mock('@/lib/auth/sso-config', () => ({
  getProviderAsync: (...args: unknown[]) => mockGetProviderAsync(...args),
}));

describe('JIT provisioning — handleSsoLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure demo mode (no DATABASE_URL)
    delete process.env.DATABASE_URL;
  });

  it('creates a user with default role "agent" when JIT enabled and no defaultRole set', async () => {
    mockGetProviderAsync.mockResolvedValue({
      id: 'provider-1',
      name: 'Test SSO',
      protocol: 'saml',
      enabled: true,
      jitEnabled: true,
      // no defaultRole set
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { handleSsoLogin } = await import('../sso-session');
    const result = await handleSsoLogin({
      email: 'newuser@example.com',
      name: 'New User',
      providerId: 'provider-1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toContain('agent');
      expect(result.token).toContain('newuser@example.com');
    }
  });

  it('creates a user with provider defaultRole when JIT enabled', async () => {
    mockGetProviderAsync.mockResolvedValue({
      id: 'provider-2',
      name: 'Admin SSO',
      protocol: 'oidc',
      enabled: true,
      jitEnabled: true,
      defaultRole: 'admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { handleSsoLogin } = await import('../sso-session');
    const result = await handleSsoLogin({
      email: 'admin@example.com',
      name: 'Admin User',
      providerId: 'provider-2',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toContain('admin');
      expect(result.token).toContain('admin@example.com');
    }
  });

  it('returns error when JIT is disabled and user does not exist', async () => {
    mockGetProviderAsync.mockResolvedValue({
      id: 'provider-3',
      name: 'Strict SSO',
      protocol: 'saml',
      enabled: true,
      jitEnabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { handleSsoLogin } = await import('../sso-session');
    const result = await handleSsoLogin({
      email: 'unknown@example.com',
      name: 'Unknown User',
      providerId: 'provider-3',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('automatic provisioning is disabled');
      expect(result.error).toContain('administrator');
    }
  });

  it('allows login when JIT is undefined (defaults to enabled)', async () => {
    mockGetProviderAsync.mockResolvedValue({
      id: 'provider-4',
      name: 'Legacy SSO',
      protocol: 'oidc',
      enabled: true,
      // jitEnabled not set — should default to allowing JIT
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { handleSsoLogin } = await import('../sso-session');
    const result = await handleSsoLogin({
      email: 'legacy@example.com',
      name: 'Legacy User',
      providerId: 'provider-4',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toBeTruthy();
    }
  });

  it('allows login when provider is not found (backward compat — no provider = JIT on)', async () => {
    mockGetProviderAsync.mockResolvedValue(undefined);

    const { handleSsoLogin } = await import('../sso-session');
    const result = await handleSsoLogin({
      email: 'noprovider@example.com',
      name: 'No Provider User',
      providerId: 'nonexistent',
    });

    // When no provider is found, JIT should still work (backward compat)
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toBeTruthy();
    }
  });

  it('uses "agent" role when provider exists but defaultRole is empty', async () => {
    mockGetProviderAsync.mockResolvedValue({
      id: 'provider-5',
      name: 'No Role SSO',
      protocol: 'saml',
      enabled: true,
      jitEnabled: true,
      defaultRole: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { handleSsoLogin } = await import('../sso-session');
    const result = await handleSsoLogin({
      email: 'norole@example.com',
      name: 'No Role User',
      providerId: 'provider-5',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toContain('agent');
    }
  });

  it('result type is SsoLoginResult with ok discriminator', async () => {
    mockGetProviderAsync.mockResolvedValue({
      id: 'provider-type-check',
      name: 'Type Check',
      protocol: 'saml',
      enabled: true,
      jitEnabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { handleSsoLogin } = await import('../sso-session');
    const result = await handleSsoLogin({
      email: 'typecheck@example.com',
      name: 'Type Check',
      providerId: 'provider-type-check',
    });

    // Verify the discriminated union shape
    expect('ok' in result).toBe(true);
    if (result.ok) {
      expect('token' in result).toBe(true);
    } else {
      expect('error' in result).toBe(true);
    }
  });
});
