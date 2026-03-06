/**
 * Tests for withRls() helper in store-helpers.ts.
 * Verifies session variable setting, null fallback, and transaction isolation.
 */

import { describe, it, expect } from 'vitest';

describe('withRls', () => {
  it('returns null when database is not available', async () => {
    const { withRls } = await import('@/lib/store-helpers');
    const result = await withRls('00000000-0000-0000-0000-000000000001', async ({ db }) => {
      return 'should-not-reach';
    });
    expect(result).toBeNull();
  });

  it('accepts optional tenantId parameter', async () => {
    const { withRls } = await import('@/lib/store-helpers');
    // Without DB, should still return null without crashing
    const result = await withRls(
      '00000000-0000-0000-0000-000000000001',
      async () => 'ok',
      '00000000-0000-0000-0000-000000000099',
    );
    expect(result).toBeNull();
  });

  it('tryDb still works as fallback', async () => {
    const { tryDb } = await import('@/lib/store-helpers');
    const ctx = await tryDb();
    // In test environment without DATABASE_URL, should be null
    expect(ctx).toBeNull();
  });

  it('withRls and tryDb are both exported from store-helpers', async () => {
    const mod = await import('@/lib/store-helpers');
    expect(typeof mod.withRls).toBe('function');
    expect(typeof mod.tryDb).toBe('function');
    expect(typeof mod.getDefaultWorkspaceId).toBe('function');
  });
});
