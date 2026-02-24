import { describe, it, expect } from 'vitest';
import { PLANS, FOUNDER_DEADLINE, isFounderEligible, getPlanQuotas } from '@/lib/billing/plans';

describe('Billing plans', () => {
  it('defines active plan tiers', () => {
    expect(Object.keys(PLANS)).toEqual(
      expect.arrayContaining(['byoc', 'pro_hosted', 'enterprise']),
    );
  });

  it('defines future pro tier', () => {
    expect(PLANS.pro).toBeDefined();
    expect(PLANS.pro.future).toBe(true);
  });

  it('includes legacy plan IDs for backwards compatibility', () => {
    expect(Object.keys(PLANS)).toEqual(
      expect.arrayContaining(['founder', 'free', 'starter', 'basic']),
    );
  });

  it('byoc plan is $0 with unlimited quotas', () => {
    expect(PLANS.byoc.price).toBe(0);
    expect(PLANS.byoc.quotas.ticketsPerMonth).toBe(Infinity);
    expect(PLANS.byoc.quotas.aiCallsPerMonth).toBe(Infinity);
    expect(PLANS.byoc.quotas.apiRequestsPerMonth).toBe(Infinity);
  });

  it('pro_hosted is $59/mo with 10,000 tickets', () => {
    expect(PLANS.pro_hosted.price).toBe(59);
    expect(PLANS.pro_hosted.quotas.ticketsPerMonth).toBe(10_000);
    expect(PLANS.pro_hosted.quotas.aiCallsPerMonth).toBe(Infinity);
    expect(PLANS.pro_hosted.quotas.apiRequestsPerMonth).toBe(Infinity);
  });

  it('enterprise has custom pricing (null)', () => {
    expect(PLANS.enterprise.price).toBeNull();
  });

  it('enterprise has unlimited quotas', () => {
    expect(PLANS.enterprise.quotas.ticketsPerMonth).toBe(Infinity);
    expect(PLANS.enterprise.quotas.aiCallsPerMonth).toBe(Infinity);
    expect(PLANS.enterprise.quotas.apiRequestsPerMonth).toBe(Infinity);
  });

  it('legacy plans all map to byoc-equivalent unlimited quotas', () => {
    for (const legacyId of ['founder', 'free', 'starter', 'basic']) {
      expect(PLANS[legacyId].price).toBe(0);
      expect(PLANS[legacyId].quotas.ticketsPerMonth).toBe(Infinity);
      expect(PLANS[legacyId].quotas.aiCallsPerMonth).toBe(Infinity);
    }
  });

  describe('FOUNDER_DEADLINE', () => {
    it('is set to Ides of March 2026 (2026-03-15T00:00:00Z)', () => {
      expect(FOUNDER_DEADLINE.toISOString()).toBe('2026-03-15T00:00:00.000Z');
    });
  });

  describe('isFounderEligible', () => {
    it('returns true for tenant created before deadline', () => {
      expect(isFounderEligible(new Date('2026-02-15T00:00:00Z'))).toBe(true);
    });

    it('returns true for tenant created exactly at deadline', () => {
      expect(isFounderEligible(new Date('2026-03-15T00:00:00.000Z'))).toBe(true);
    });

    it('returns false for tenant created after deadline', () => {
      expect(isFounderEligible(new Date('2026-03-15T00:01:00Z'))).toBe(false);
    });

    it('returns false for tenant created well after deadline', () => {
      expect(isFounderEligible(new Date('2026-06-01T00:00:00Z'))).toBe(false);
    });
  });

  describe('getPlanQuotas', () => {
    it('returns correct quotas for active plans', () => {
      expect(getPlanQuotas('byoc').ticketsPerMonth).toBe(Infinity);
      expect(getPlanQuotas('pro_hosted').ticketsPerMonth).toBe(10_000);
      expect(getPlanQuotas('enterprise').ticketsPerMonth).toBe(Infinity);
    });

    it('returns unlimited quotas for legacy plans', () => {
      expect(getPlanQuotas('free').ticketsPerMonth).toBe(Infinity);
      expect(getPlanQuotas('starter').ticketsPerMonth).toBe(Infinity);
      expect(getPlanQuotas('basic').ticketsPerMonth).toBe(Infinity);
      expect(getPlanQuotas('founder').ticketsPerMonth).toBe(Infinity);
    });

    it('falls back to byoc tier for unknown plans', () => {
      expect(getPlanQuotas('nonexistent')).toEqual(PLANS.byoc.quotas);
    });
  });
});
