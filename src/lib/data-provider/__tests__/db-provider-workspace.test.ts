import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Tests that getWorkspaceId prefers the session workspace over
 * env var or first-workspace fallback.
 */

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}));

// Stub DB that records calls
function mockDb(rows: Array<{ id: string }> = [{ id: 'fallback-ws' }]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return {
    select: vi.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

const mockSchema = {
  workspaces: {
    id: 'workspaces.id',
    name: 'workspaces.name',
    createdAt: 'workspaces.created_at',
  },
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('getWorkspaceId', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns session workspaceId when user is authenticated', async () => {
    const { getSession } = await import('@/lib/auth');
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u1', email: 'a@b.com', name: 'A', role: 'owner',
      workspaceId: 'session-ws-123', tenantId: 't1',
    });

    const { getWorkspaceId } = await import('../db-provider');
    const db = mockDb();
    const result = await getWorkspaceId(db, mockSchema);

    expect(result).toBe('session-ws-123');
    // DB should NOT have been queried
    expect(db.select).not.toHaveBeenCalled();
  });

  it('falls through to env var when getSession returns null', async () => {
    const { getSession } = await import('@/lib/auth');
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.stubEnv('CLIAAS_WORKSPACE', 'my-workspace');

    const { getWorkspaceId } = await import('../db-provider');
    const db = mockDb([{ id: 'env-ws-456' }]);
    const result = await getWorkspaceId(db, mockSchema);

    expect(result).toBe('env-ws-456');
    expect(db.select).toHaveBeenCalled();
  });

  it('falls through to env var when getSession throws (CLI context)', async () => {
    const { getSession } = await import('@/lib/auth');
    (getSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('cookies() can only be called in a Server Component'),
    );
    vi.stubEnv('CLIAAS_WORKSPACE', 'cli-workspace');

    const { getWorkspaceId } = await import('../db-provider');
    const db = mockDb([{ id: 'cli-ws-789' }]);
    const result = await getWorkspaceId(db, mockSchema);

    expect(result).toBe('cli-ws-789');
    expect(db.select).toHaveBeenCalled();
  });

  it('falls through to first workspace when no session and no env var', async () => {
    const { getSession } = await import('@/lib/auth');
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.stubEnv('CLIAAS_WORKSPACE', '');

    const { getWorkspaceId } = await import('../db-provider');
    const db = mockDb([{ id: 'first-ws' }]);
    const result = await getWorkspaceId(db, mockSchema);

    expect(result).toBe('first-ws');
  });

  it('returns null when no workspace exists at all', async () => {
    const { getSession } = await import('@/lib/auth');
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.stubEnv('CLIAAS_WORKSPACE', '');

    const { getWorkspaceId } = await import('../db-provider');
    const db = mockDb([]);
    const result = await getWorkspaceId(db, mockSchema);

    expect(result).toBeNull();
  });
});
