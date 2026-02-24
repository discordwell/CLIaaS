import { describe, it, expect } from 'vitest';

describe('rls', () => {
  it('withTenantContext throws without database', async () => {
    const { withTenantContext } = await import('@/db/rls');
    await expect(
      withTenantContext('ws-1', 'tenant-1', async () => 'ok'),
    ).rejects.toThrow('Database not available');
  });

  it('withSystemContext throws without database', async () => {
    const { withSystemContext } = await import('@/db/rls');
    await expect(
      withSystemContext(async () => 'ok'),
    ).rejects.toThrow('Database not available');
  });

  it('verifyRlsSetup reports unavailable without database', async () => {
    const { verifyRlsSetup } = await import('@/db/rls');
    const result = await verifyRlsSetup();
    expect(result.available).toBe(false);
    expect(result.error).toBe('Database not configured');
  });
});
