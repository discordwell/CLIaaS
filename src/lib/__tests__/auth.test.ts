import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test the module with different env vars, so we dynamically import
describe('auth', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('createToken returns a JWT string', async () => {
    const { createToken } = await import('@/lib/auth');
    const token = await createToken({
      id: 'u1',
      email: 'a@b.com',
      name: 'Alice',
      role: 'admin',
      workspaceId: 'ws1',
      tenantId: 't1',
    });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifyToken decodes a valid token', async () => {
    const { createToken, verifyToken } = await import('@/lib/auth');
    const user = {
      id: 'u1',
      email: 'a@b.com',
      name: 'Alice',
      role: 'admin',
      workspaceId: 'ws1',
      tenantId: 't1',
    };
    const token = await createToken(user);
    const decoded = await verifyToken(token);
    expect(decoded).toMatchObject(user);
  });

  it('verifyToken returns null for invalid token', async () => {
    const { verifyToken } = await import('@/lib/auth');
    const result = await verifyToken('not.a.jwt');
    expect(result).toBeNull();
  });

  it('verifyToken returns null for empty string', async () => {
    const { verifyToken } = await import('@/lib/auth');
    const result = await verifyToken('');
    expect(result).toBeNull();
  });

  it('round-trip preserves all user fields', async () => {
    const { createToken, verifyToken } = await import('@/lib/auth');
    const user = {
      id: 'user-42',
      email: 'bob@example.com',
      name: 'Bob',
      role: 'agent',
      workspaceId: 'ws-99',
      tenantId: 'ten-1',
    };
    const token = await createToken(user);
    const decoded = await verifyToken(token);
    expect(decoded?.id).toBe(user.id);
    expect(decoded?.email).toBe(user.email);
    expect(decoded?.name).toBe(user.name);
    expect(decoded?.role).toBe(user.role);
    expect(decoded?.workspaceId).toBe(user.workspaceId);
    expect(decoded?.tenantId).toBe(user.tenantId);
  });

  it('verifyToken rejects a tampered token', async () => {
    const { createToken, verifyToken } = await import('@/lib/auth');
    const token = await createToken({
      id: 'u1',
      email: 'a@b.com',
      name: 'Alice',
      role: 'admin',
      workspaceId: 'ws1',
      tenantId: 't1',
    });
    // Tamper with the payload
    const parts = token.split('.');
    parts[1] = parts[1] + 'x';
    const tampered = parts.join('.');
    const result = await verifyToken(tampered);
    expect(result).toBeNull();
  });

  it('throws in production when AUTH_SECRET is missing', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.AUTH_SECRET;
    const { createToken } = await import('@/lib/auth');
    await expect(
      createToken({ id: 'u1', email: 'a@b.com', name: 'A', role: 'admin', workspaceId: 'ws1', tenantId: 't1' }),
    ).rejects.toThrow('AUTH_SECRET environment variable is required in production');
  });

  it('uses fallback secret in development', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    delete process.env.AUTH_SECRET;
    const { createToken, verifyToken } = await import('@/lib/auth');
    const token = await createToken({
      id: 'u1',
      email: 'a@b.com',
      name: 'A',
      role: 'admin',
      workspaceId: 'ws1',
      tenantId: 't1',
    });
    const decoded = await verifyToken(token);
    expect(decoded?.id).toBe('u1');
  });
});
