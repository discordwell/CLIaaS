import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('seedWorkspaceWithSampleData', () => {
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
    tenants: { id: 'id', name: 'name' },
    workspaces: { id: 'id', name: 'name' },
  };

  it('resolves tenant/workspace names and calls ingestZendeskExportDir', async () => {
    const mockIngest = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/db', () => mockDbWithResults(
      [{ name: 'acme-corp' }],       // tenant lookup
      [{ name: 'acme-workspace' }],   // workspace lookup
    ));
    vi.doMock('@/db/schema', () => schemaStub);
    vi.doMock('@/lib/zendesk/ingest', () => ({
      ingestZendeskExportDir: mockIngest,
    }));

    const { seedWorkspaceWithSampleData } = await import('@/lib/onboarding/seed-sample-data');
    await seedWorkspaceWithSampleData({ tenantId: 't1', workspaceId: 'ws1' });

    expect(mockIngest).toHaveBeenCalledOnce();
    const call = mockIngest.mock.calls[0][0];
    expect(call.tenant).toBe('acme-corp');
    expect(call.workspace).toBe('acme-workspace');
    expect(call.dir).toContain('fixtures/demo-data');
  });

  it('throws if tenant not found', async () => {
    vi.doMock('@/db', () => mockDbWithResults([]));
    vi.doMock('@/db/schema', () => schemaStub);

    const { seedWorkspaceWithSampleData } = await import('@/lib/onboarding/seed-sample-data');
    await expect(
      seedWorkspaceWithSampleData({ tenantId: 'bad', workspaceId: 'ws1' })
    ).rejects.toThrow('Tenant bad not found');
  });

  it('throws if workspace not found', async () => {
    vi.doMock('@/db', () => mockDbWithResults(
      [{ name: 'acme' }],  // tenant found
      [],                    // workspace not found
    ));
    vi.doMock('@/db/schema', () => schemaStub);

    const { seedWorkspaceWithSampleData } = await import('@/lib/onboarding/seed-sample-data');
    await expect(
      seedWorkspaceWithSampleData({ tenantId: 't1', workspaceId: 'bad' })
    ).rejects.toThrow('Workspace bad not found');
  });
});
