/**
 * Usage tracking and quota enforcement.
 * All functions are demo-safe: no-op when DATABASE_URL is unset.
 */

import { getPlanQuotas } from './plans';

export type UsageMetric = 'ticket' | 'ai_call' | 'api_request';

interface QuotaResult {
  allowed: boolean;
  current: number;
  limit: number;
  metric: UsageMetric;
}

interface UsageSummary {
  ticketsCreated: number;
  aiCallsMade: number;
  apiRequestsMade: number;
  period: string;
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get current usage for a tenant in the current billing period.
 * Returns zeros in demo mode.
 */
export async function getCurrentUsage(tenantId: string): Promise<UsageSummary> {
  const period = currentPeriod();

  if (!process.env.DATABASE_URL) {
    return { ticketsCreated: 0, aiCallsMade: 0, apiRequestsMade: 0, period };
  }

  const { db } = await import('@/db');
  const { usageMetrics } = await import('@/db/schema');
  const { eq, and } = await import('drizzle-orm');

  const [row] = await db
    .select({
      ticketsCreated: usageMetrics.ticketsCreated,
      aiCallsMade: usageMetrics.aiCallsMade,
      apiRequestsMade: usageMetrics.apiRequestsMade,
    })
    .from(usageMetrics)
    .where(and(eq(usageMetrics.tenantId, tenantId), eq(usageMetrics.period, period)))
    .limit(1);

  return {
    ticketsCreated: row?.ticketsCreated ?? 0,
    aiCallsMade: row?.aiCallsMade ?? 0,
    apiRequestsMade: row?.apiRequestsMade ?? 0,
    period,
  };
}

/**
 * Check if a tenant is within quota for a given metric.
 * Always returns `{allowed: true}` in demo mode.
 */
export async function checkQuota(tenantId: string, metric: UsageMetric): Promise<QuotaResult> {
  if (!process.env.DATABASE_URL) {
    return { allowed: true, current: 0, limit: Infinity, metric };
  }

  // Look up tenant plan
  const { db } = await import('@/db');
  const { tenants } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const [tenant] = await db
    .select({ plan: tenants.plan })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const plan = tenant?.plan ?? 'byoc';
  const quotas = getPlanQuotas(plan);
  const usage = await getCurrentUsage(tenantId);

  const metricMap: Record<UsageMetric, { current: number; limit: number }> = {
    ticket: { current: usage.ticketsCreated, limit: quotas.ticketsPerMonth },
    ai_call: { current: usage.aiCallsMade, limit: quotas.aiCallsPerMonth },
    api_request: { current: usage.apiRequestsMade, limit: quotas.apiRequestsPerMonth },
  };

  const { current, limit } = metricMap[metric];
  return { allowed: current < limit, current, limit, metric };
}

/**
 * Increment a usage metric for a tenant. No-op in demo mode.
 */
export async function incrementUsage(tenantId: string, metric: UsageMetric): Promise<void> {
  if (!process.env.DATABASE_URL) return;

  const period = currentPeriod();
  const { db } = await import('@/db');
  const { usageMetrics } = await import('@/db/schema');
  const { eq, and, sql } = await import('drizzle-orm');

  const metricColumns = {
    ticket: { field: 'ticketsCreated' as const, col: usageMetrics.ticketsCreated },
    ai_call: { field: 'aiCallsMade' as const, col: usageMetrics.aiCallsMade },
    api_request: { field: 'apiRequestsMade' as const, col: usageMetrics.apiRequestsMade },
  };

  const { field, col } = metricColumns[metric];

  // Upsert: insert or increment
  await db
    .insert(usageMetrics)
    .values({
      tenantId,
      period,
      ticketsCreated: metric === 'ticket' ? 1 : 0,
      aiCallsMade: metric === 'ai_call' ? 1 : 0,
      apiRequestsMade: metric === 'api_request' ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [usageMetrics.tenantId, usageMetrics.period],
      set: {
        [field]: sql`${col} + 1`,
        updatedAt: new Date(),
      },
    });
}
