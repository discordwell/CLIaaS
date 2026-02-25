import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('domain-matching', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  function mockDbWithResults(...results: unknown[][]) {
    let callIndex = 0;
    return {
      db: {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(() => {
                const result = results[callIndex] ?? [];
                callIndex++;
                return Promise.resolve(result);
              }),
            }),
          }),
        })),
      },
    };
  }

  const schemaStub = {
    organizations: {
      id: 'id',
      name: 'name',
      workspaceId: 'workspace_id',
      domains: 'domains',
    },
    workspaces: {
      id: 'id',
      tenantId: 'tenant_id',
    },
  };

  it('returns null when no org matches the domain', async () => {
    vi.doMock('@/db', () => mockDbWithResults([]));
    vi.doMock('@/db/schema', () => schemaStub);

    const { findOrgByDomain } = await import('@/lib/auth/domain-matching');
    const result = await findOrgByDomain('nonexistent.com');
    expect(result).toBeNull();
  });

  it('returns org match when domain is found', async () => {
    const mockOrgRow = { orgId: 'org-001', orgName: 'Acme', workspaceId: 'ws-001' };
    const mockWsRow = { tenantId: 'tenant-001' };

    vi.doMock('@/db', () => mockDbWithResults([mockOrgRow], [mockWsRow]));
    vi.doMock('@/db/schema', () => schemaStub);

    const { findOrgByDomain } = await import('@/lib/auth/domain-matching');
    const result = await findOrgByDomain('acme.com');

    expect(result).not.toBeNull();
    expect(result!.orgId).toBe('org-001');
    expect(result!.orgName).toBe('Acme');
    expect(result!.workspaceId).toBe('ws-001');
    expect(result!.tenantId).toBe('tenant-001');
  });

  it('returns null when org exists but workspace lookup fails', async () => {
    const mockOrgRow = { orgId: 'org-001', orgName: 'Acme', workspaceId: 'ws-missing' };

    vi.doMock('@/db', () => mockDbWithResults([mockOrgRow], []));
    vi.doMock('@/db/schema', () => schemaStub);

    const { findOrgByDomain } = await import('@/lib/auth/domain-matching');
    const result = await findOrgByDomain('acme.com');
    expect(result).toBeNull();
  });
});
