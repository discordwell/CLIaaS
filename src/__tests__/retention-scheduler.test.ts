import { describe, it, expect } from 'vitest';
import { enforceRetentionPolicies } from '@/lib/compliance/retention-scheduler';

describe('retention-scheduler', () => {
  it('returns empty results in demo mode', async () => {
    // No DATABASE_URL — should skip enforcement
    const results = await enforceRetentionPolicies('demo-workspace');
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it('enforceRetentionPolicies is a no-op without DB', async () => {
    // Verify it doesn't throw in demo mode
    const results = await enforceRetentionPolicies('any-workspace');
    expect(results).toEqual([]);
  });
});
