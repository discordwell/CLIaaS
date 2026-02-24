/**
 * Feature gating — tier resolution + re-exports.
 */

export {
  FEATURE_MATRIX,
  FEATURE_LABELS,
  TIER_LABELS,
  isFeatureEnabled,
  getAvailableFeatures,
  getMinimumTier,
} from './gates';

export type { TierLevel, Feature } from './gates';

/**
 * Resolve the tier level for a given tenant.
 *
 * Reads the tenant's `plan` column from the DB and maps it to a TierLevel.
 * Falls back to 'byoc' when no DB is available or tenant is not found
 * (most permissive local tier — customer owns their own infra).
 */
export async function getTierForTenant(tenantId: string): Promise<import('./gates').TierLevel> {
  try {
    // Dynamic import to avoid pulling DB deps into client bundles
    const { db } = await import('@/db');
    const { tenants } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    const rows = await db
      .select({ plan: tenants.plan })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (rows.length === 0) return 'byoc';

    const plan = rows[0].plan;
    const validTiers: import('./gates').TierLevel[] = [
      'byoc', 'free', 'founder', 'starter', 'pro', 'enterprise',
    ];
    if (validTiers.includes(plan as import('./gates').TierLevel)) {
      return plan as import('./gates').TierLevel;
    }

    // Unknown plan string — fall back to free for hosted, byoc for local
    return 'free';
  } catch {
    // No DB connection (BYOC / local mode) — return most permissive tier
    return 'byoc';
  }
}
