import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('gdpr-db exportUserDataFromDb', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('falls back to demo mode when no DB is available', async () => {
    // getDb returns null → demo mode
    vi.doMock('@/db', () => ({ getDb: () => null }));
    const { exportUserDataFromDb } = await import('../gdpr-db');
    const result = await exportUserDataFromDb('user-1', 'ws-1');
    expect(result.userId).toBe('user-1');
    expect(result.workspaceId).toBe('ws-1');
    expect(result.exportedAt).toBeTruthy();
  });
});
