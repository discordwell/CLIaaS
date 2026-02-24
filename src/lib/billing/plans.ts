/**
 * Billing plan definitions, founder eligibility, and quota lookups.
 */

export interface PlanQuotas {
  ticketsPerMonth: number;
  aiCallsPerMonth: number;
  apiRequestsPerMonth: number;
}

export interface PlanDefinition {
  id: string;
  name: string;
  price: number | null; // null = custom pricing
  quotas: PlanQuotas;
}

export const PLANS: Record<string, PlanDefinition> = {
  founder: {
    id: 'founder',
    name: 'Founder',
    price: 0,
    quotas: { ticketsPerMonth: 10_000, aiCallsPerMonth: 1_000, apiRequestsPerMonth: 25_000 },
  },
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    quotas: { ticketsPerMonth: 100, aiCallsPerMonth: 10, apiRequestsPerMonth: 1_000 },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 29,
    quotas: { ticketsPerMonth: 1_000, aiCallsPerMonth: 100, apiRequestsPerMonth: 5_000 },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 99,
    quotas: { ticketsPerMonth: 10_000, aiCallsPerMonth: 1_000, apiRequestsPerMonth: 25_000 },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: null,
    quotas: { ticketsPerMonth: Infinity, aiCallsPerMonth: Infinity, apiRequestsPerMonth: Infinity },
  },
};

/** Feb 28 2026 11:59:59 PM PST = Mar 1 2026 07:59:59 UTC */
export const FOUNDER_DEADLINE = new Date('2026-03-01T07:59:59Z');

/**
 * Check if a tenant created at `createdAt` qualifies for the Founder plan.
 */
export function isFounderEligible(createdAt: Date): boolean {
  return createdAt.getTime() <= FOUNDER_DEADLINE.getTime();
}

/**
 * Get quotas for a plan. Falls back to free tier for unknown plans.
 */
export function getPlanQuotas(planId: string): PlanQuotas {
  return PLANS[planId]?.quotas ?? PLANS.free.quotas;
}
