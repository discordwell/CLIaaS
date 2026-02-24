import { describe, it, expect } from 'vitest';
import { PLANS, FOUNDER_DEADLINE, isFounderEligible, getPlanQuotas } from '@/lib/billing/plans';

describe('Billing plans', () => {
  it('defines all six plan tiers', () => {
    expect(Object.keys(PLANS)).toEqual(
      expect.arrayContaining(['byoc', 'founder', 'free', 'starter', 'pro', 'enterprise']),
    );
    expect(Object.keys(PLANS)).toHaveLength(6);
  });

  it('byoc, founder, and free plans are $0', () => {
    expect(PLANS.byoc.price).toBe(0);
    expect(PLANS.founder.price).toBe(0);
    expect(PLANS.free.price).toBe(0);
  });

  it('byoc has unlimited quotas', () => {
    expect(PLANS.byoc.quotas.ticketsPerMonth).toBe(Infinity);
    expect(PLANS.byoc.quotas.aiCallsPerMonth).toBe(Infinity);
    expect(PLANS.byoc.quotas.apiRequestsPerMonth).toBe(Infinity);
  });

  it('starter is $29/mo and pro is $99/mo', () => {
    expect(PLANS.starter.price).toBe(29);
    expect(PLANS.pro.price).toBe(99);
  });

  it('enterprise has custom pricing (null)', () => {
    expect(PLANS.enterprise.price).toBeNull();
  });

  it('enterprise has unlimited quotas', () => {
    expect(PLANS.enterprise.quotas.ticketsPerMonth).toBe(Infinity);
    expect(PLANS.enterprise.quotas.aiCallsPerMonth).toBe(Infinity);
    expect(PLANS.enterprise.quotas.apiRequestsPerMonth).toBe(Infinity);
  });

  it('founder quotas match pro quotas', () => {
    expect(PLANS.founder.quotas).toEqual(PLANS.pro.quotas);
  });

  describe('FOUNDER_DEADLINE', () => {
    it('is set to Mar 1 2026 07:59:59 UTC (= Feb 28 11:59:59 PM PST)', () => {
      expect(FOUNDER_DEADLINE.toISOString()).toBe('2026-03-01T07:59:59.000Z');
    });
  });

  describe('isFounderEligible', () => {
    it('returns true for tenant created before deadline', () => {
      expect(isFounderEligible(new Date('2026-02-15T00:00:00Z'))).toBe(true);
    });

    it('returns true for tenant created exactly at deadline', () => {
      expect(isFounderEligible(new Date('2026-03-01T07:59:59.000Z'))).toBe(true);
    });

    it('returns false for tenant created after deadline', () => {
      expect(isFounderEligible(new Date('2026-03-01T08:00:00Z'))).toBe(false);
    });

    it('returns false for tenant created well after deadline', () => {
      expect(isFounderEligible(new Date('2026-06-01T00:00:00Z'))).toBe(false);
    });
  });

  describe('getPlanQuotas', () => {
    it('returns correct quotas for known plans', () => {
      expect(getPlanQuotas('free').ticketsPerMonth).toBe(100);
      expect(getPlanQuotas('starter').ticketsPerMonth).toBe(1_000);
      expect(getPlanQuotas('pro').ticketsPerMonth).toBe(10_000);
    });

    it('falls back to free tier for unknown plans', () => {
      expect(getPlanQuotas('nonexistent')).toEqual(PLANS.free.quotas);
    });
  });
});
