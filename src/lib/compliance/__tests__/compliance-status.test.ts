import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('getComplianceStatus', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_URL;
  });

  it('returns policies from in-memory fallback when no workspaceId', async () => {
    const { getComplianceStatus } = await import('@/lib/compliance');
    const status = await getComplianceStatus();
    expect(status.totalRetentionPolicies).toBeGreaterThan(0);
    expect(status.policySummary.length).toBe(status.totalRetentionPolicies);
  });

  it('accepts optional workspaceId parameter', async () => {
    const { getComplianceStatus } = await import('@/lib/compliance');
    // Without DB, falls back to in-memory regardless of workspaceId
    const status = await getComplianceStatus('some-workspace-id');
    expect(status.totalRetentionPolicies).toBeGreaterThan(0);
  });
});
