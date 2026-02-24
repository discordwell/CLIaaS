/**
 * Billing plan definitions, founder eligibility, and quota lookups.
 *
 * Tiers: byoc (free) → pro_hosted ($59/mo) → enterprise (custom)
 * Future: pro (~$20/mo) — defined but not purchasable yet.
 * Legacy IDs (founder, free, starter, basic) all resolve to byoc quotas.
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
  yearlyPrice: number | null;
  quotas: PlanQuotas;
  /** If true, plan is defined but not yet available for purchase. */
  future?: boolean;
}

/* ── Shared quota presets ─────────────────────────────────────────────────── */

const UNLIMITED: PlanQuotas = {
  ticketsPerMonth: Infinity,
  aiCallsPerMonth: Infinity,
  apiRequestsPerMonth: Infinity,
};

/* ── Plan definitions ─────────────────────────────────────────────────────── */

export const PLANS: Record<string, PlanDefinition> = {
  // ── Active tiers ──
  byoc: {
    id: 'byoc',
    name: 'BYOC',
    price: 0,
    yearlyPrice: 0,
    quotas: { ...UNLIMITED },
  },
  pro_hosted: {
    id: 'pro_hosted',
    name: 'Pro Hosted',
    price: 59,
    yearlyPrice: null,
    quotas: { ticketsPerMonth: 10_000, aiCallsPerMonth: Infinity, apiRequestsPerMonth: Infinity },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: null,
    yearlyPrice: null,
    quotas: { ...UNLIMITED },
  },

  // ── Future tier (defined, not purchasable) ──
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 20,
    yearlyPrice: 200,
    quotas: { ticketsPerMonth: 1_000, aiCallsPerMonth: Infinity, apiRequestsPerMonth: Infinity },
    future: true,
  },

  // ── Legacy plan IDs — all map to byoc quotas ──
  founder: {
    id: 'founder',
    name: 'Founder (BYOC)',
    price: 0,
    yearlyPrice: 0,
    quotas: { ...UNLIMITED },
  },
  free: {
    id: 'free',
    name: 'Free (BYOC)',
    price: 0,
    yearlyPrice: 0,
    quotas: { ...UNLIMITED },
  },
  starter: {
    id: 'starter',
    name: 'Starter (BYOC)',
    price: 0,
    yearlyPrice: 0,
    quotas: { ...UNLIMITED },
  },
  basic: {
    id: 'basic',
    name: 'Basic (BYOC)',
    price: 0,
    yearlyPrice: 0,
    quotas: { ...UNLIMITED },
  },
};

/** Ides of March 2026 — free-forever cutoff for early signups. */
export const FOUNDER_DEADLINE = new Date('2026-03-15T00:00:00Z');

/**
 * Check if a tenant created at `createdAt` qualifies for the free-forever BYOC plan.
 */
export function isFounderEligible(createdAt: Date): boolean {
  return createdAt.getTime() <= FOUNDER_DEADLINE.getTime();
}

/**
 * Get quotas for a plan. Falls back to byoc tier for unknown plans.
 */
export function getPlanQuotas(planId: string): PlanQuotas {
  return PLANS[planId]?.quotas ?? PLANS.byoc.quotas;
}
