import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('createOrJoinAccount', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DATABASE_URL = 'postgres://fake';
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('creates a new workspace for personal email with workspaceName', async () => {
    const mockUser = { id: 'u1', email: 'alice@gmail.com', name: 'Alice', role: 'owner' };
    const mockResult = { user: mockUser, workspaceId: 'ws1', tenantId: 't1' };

    vi.doMock('@/lib/auth/domain-matching', () => ({
      findOrgByDomain: vi.fn().mockResolvedValue(null),
    }));

    // Mock createAccount inline — we don't call the real DB
    vi.doMock('@/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn()
              .mockResolvedValueOnce([{ id: 't1' }])     // tenant
              .mockResolvedValueOnce([{ id: 'ws1' }])     // workspace
              .mockResolvedValueOnce([mockUser]),          // user
          }),
        }),
      },
    }));

    vi.doMock('@/db/schema', () => ({
      users: { id: 'id', email: 'email', name: 'name', role: 'role' },
      tenants: { id: 'id' },
      workspaces: { id: 'id' },
      organizations: { id: 'id', workspaceId: 'workspace_id', name: 'name', domains: 'domains' },
    }));

    const { createOrJoinAccount } = await import('@/lib/auth/create-account');
    const result = await createOrJoinAccount({
      email: 'alice@gmail.com',
      name: 'Alice',
      workspaceName: 'alice-team',
      passwordHash: 'hash123',
    });

    expect(result.joined).toBe(false);
    expect(result.orgName).toBeNull();
    expect(result.user.role).toBe('owner');
  });

  it('throws when personal email has no workspaceName', async () => {
    vi.doMock('@/lib/auth/domain-matching', () => ({
      findOrgByDomain: vi.fn().mockResolvedValue(null),
    }));

    const { createOrJoinAccount } = await import('@/lib/auth/create-account');

    await expect(
      createOrJoinAccount({
        email: 'alice@gmail.com',
        name: 'Alice',
        passwordHash: 'hash123',
      })
    ).rejects.toThrow('Workspace name is required');
  });

  it('joins existing workspace when work email matches an org', async () => {
    const mockMatch = {
      orgId: 'org-1',
      orgName: 'Acme',
      workspaceId: 'ws-existing',
      tenantId: 't-existing',
    };

    vi.doMock('@/lib/auth/domain-matching', () => ({
      findOrgByDomain: vi.fn().mockResolvedValue(mockMatch),
    }));

    const mockUser = { id: 'u2', email: 'bob@acme.com', name: 'Bob', role: 'agent' };

    vi.doMock('@/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockUser]),
          }),
        }),
      },
    }));

    vi.doMock('@/db/schema', () => ({
      users: { id: 'id', email: 'email', name: 'name', role: 'role' },
      tenants: { id: 'id' },
      workspaces: { id: 'id' },
      organizations: { id: 'id', workspaceId: 'workspace_id', name: 'name', domains: 'domains' },
    }));

    const { createOrJoinAccount } = await import('@/lib/auth/create-account');
    const result = await createOrJoinAccount({
      email: 'bob@acme.com',
      name: 'Bob',
      passwordHash: 'hash456',
    });

    expect(result.joined).toBe(true);
    expect(result.orgName).toBe('Acme');
    expect(result.workspaceId).toBe('ws-existing');
    expect(result.user.role).toBe('agent');
  });

  it('creates new workspace for work email with no existing org', async () => {
    vi.doMock('@/lib/auth/domain-matching', () => ({
      findOrgByDomain: vi.fn().mockResolvedValue(null),
    }));

    const mockUser = { id: 'u3', email: 'carol@newcorp.io', name: 'Carol', role: 'owner' };

    vi.doMock('@/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn()
              .mockResolvedValueOnce([{ id: 't3' }])     // tenant
              .mockResolvedValueOnce([{ id: 'ws3' }])     // workspace
              .mockResolvedValueOnce([mockUser])           // user
              .mockResolvedValueOnce([{ id: 'org3' }]),    // organization
          }),
        }),
      },
    }));

    vi.doMock('@/db/schema', () => ({
      users: { id: 'id', email: 'email', name: 'name', role: 'role' },
      tenants: { id: 'id' },
      workspaces: { id: 'id' },
      organizations: { id: 'id', workspaceId: 'workspace_id', name: 'name', domains: 'domains' },
    }));

    const { createOrJoinAccount } = await import('@/lib/auth/create-account');
    const result = await createOrJoinAccount({
      email: 'carol@newcorp.io',
      name: 'Carol',
      passwordHash: 'hash789',
    });

    expect(result.joined).toBe(false);
    expect(result.orgName).toBe('newcorp');
    expect(result.user.role).toBe('owner');
  });
});
