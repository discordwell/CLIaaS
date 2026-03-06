/**
 * Seat availability checks for billing enforcement.
 *
 * Full seats = owner + admin + agent (paid)
 * Light agent seats = light_agent (free up to 50)
 * Collaborator + viewer seats = free, unlimited
 */

const FULL_SEAT_ROLES = new Set(['owner', 'admin', 'agent']);
const LIGHT_AGENT_ROLES = new Set(['light_agent']);
const FREE_ROLES = new Set(['collaborator', 'viewer']);

export interface SeatAvailability {
  allowed: boolean;
  reason?: string;
  currentFullSeats?: number;
  currentLightSeats?: number;
  maxFullSeats?: number;
  maxLightSeats?: number;
}

/**
 * Check if a workspace can add/change a user to the given role
 * based on billing plan seat limits.
 */
export async function checkSeatAvailability(
  workspaceId: string,
  tenantId: string,
  targetRole: string,
): Promise<SeatAvailability> {
  // Free roles always allowed
  if (FREE_ROLES.has(targetRole)) {
    return { allowed: true };
  }

  // Demo mode — always allowed
  if (!process.env.DATABASE_URL) {
    return { allowed: true };
  }

  try {
    const { db } = await import('@/db');
    const { users, tenants } = await import('@/db/schema');
    const { eq, and, inArray } = await import('drizzle-orm');

    // Get current seat counts
    const allUsers = await db
      .select({ role: users.role, status: users.status })
      .from(users)
      .where(
        and(
          eq(users.workspaceId, workspaceId),
          inArray(users.status, ['active', 'invited']),
        ),
      );

    const currentFullSeats = allUsers.filter(u => FULL_SEAT_ROLES.has(u.role)).length;
    const currentLightSeats = allUsers.filter(u => LIGHT_AGENT_ROLES.has(u.role)).length;

    // Get plan limits
    const [tenant] = await db
      .select({ plan: tenants.plan })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const limits = getPlanSeatLimits(tenant?.plan ?? 'free');

    if (FULL_SEAT_ROLES.has(targetRole)) {
      if (currentFullSeats >= limits.maxFullSeats) {
        return {
          allowed: false,
          reason: `Full seat limit reached (${currentFullSeats}/${limits.maxFullSeats}). Upgrade your plan or use light_agent/collaborator roles.`,
          currentFullSeats,
          maxFullSeats: limits.maxFullSeats,
        };
      }
    }

    if (LIGHT_AGENT_ROLES.has(targetRole)) {
      if (currentLightSeats >= limits.maxLightSeats) {
        return {
          allowed: false,
          reason: `Light agent seat limit reached (${currentLightSeats}/${limits.maxLightSeats}).`,
          currentLightSeats,
          maxLightSeats: limits.maxLightSeats,
        };
      }
    }

    return {
      allowed: true,
      currentFullSeats,
      currentLightSeats,
      maxFullSeats: limits.maxFullSeats,
      maxLightSeats: limits.maxLightSeats,
    };
  } catch {
    // On error, allow (don't block operations due to billing check failures)
    return { allowed: true };
  }
}

function getPlanSeatLimits(plan: string): { maxFullSeats: number; maxLightSeats: number } {
  switch (plan) {
    case 'byoc':
      return { maxFullSeats: Infinity, maxLightSeats: Infinity };
    case 'enterprise':
      return { maxFullSeats: Infinity, maxLightSeats: Infinity };
    case 'founder':
    case 'pro':
      return { maxFullSeats: 25, maxLightSeats: 50 };
    case 'starter':
      return { maxFullSeats: 10, maxLightSeats: 25 };
    case 'free':
    default:
      return { maxFullSeats: 3, maxLightSeats: 10 };
  }
}
