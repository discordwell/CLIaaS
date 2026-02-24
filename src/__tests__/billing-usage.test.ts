import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Billing usage (demo mode)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('checkQuota returns {allowed: true} in demo mode', async () => {
    const { checkQuota } = await import('@/lib/billing/usage');
    const result = await checkQuota('any-tenant', 'ticket');
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(0);
    expect(result.limit).toBe(Infinity);
  });

  it('getCurrentUsage returns zeros in demo mode', async () => {
    const { getCurrentUsage } = await import('@/lib/billing/usage');
    const usage = await getCurrentUsage('any-tenant');
    expect(usage.ticketsCreated).toBe(0);
    expect(usage.aiCallsMade).toBe(0);
    expect(usage.apiRequestsMade).toBe(0);
    expect(usage.period).toMatch(/^\d{4}-\d{2}$/);
  });

  it('incrementUsage is a no-op in demo mode', async () => {
    const { incrementUsage } = await import('@/lib/billing/usage');
    // Should not throw
    await expect(incrementUsage('any-tenant', 'ticket')).resolves.toBeUndefined();
  });

  it('checkQuota works for all metric types', async () => {
    const { checkQuota } = await import('@/lib/billing/usage');
    const ticket = await checkQuota('t1', 'ticket');
    const ai = await checkQuota('t1', 'ai_call');
    const api = await checkQuota('t1', 'api_request');
    expect(ticket.allowed).toBe(true);
    expect(ai.allowed).toBe(true);
    expect(api.allowed).toBe(true);
  });
});
