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

export interface SeatDecisionInput {
  currentFullSeats: number;
  currentLightSeats: number;
  maxFullSeats: number;
  maxLightSeats: number;
  targetRole: string;
  /**
   * The user's existing role when re-roling an EXISTING user. Omit (undefined)
   * for brand-new users (invites). `currentFullSeats`/`currentLightSeats` are
   * the live counts, which already include this user under their current role.
   */
  currentRole?: string;
}

/**
 * Pure seat-availability decision, given current counts and limits.
 *
 * A seat is only newly consumed when the user moves INTO a seat class they are
 * not already in. Re-roling within the same seat class (e.g. agent -> admin,
 * both "full" seats) is seat-neutral and must never be blocked — even when the
 * workspace is exactly at its cap — because the live count already includes
 * that user's seat. Counting it as a fresh seat double-counts the user and
 * wrongly rejects legitimate role changes for any workspace sitting at its cap.
 *
 * Exported for unit testing without a database.
 */
export function evaluateSeatDecision(input: SeatDecisionInput): SeatAvailability {
  const {
    currentFullSeats,
    currentLightSeats,
    maxFullSeats,
    maxLightSeats,
    targetRole,
    currentRole,
  } = input;

  if (FREE_ROLES.has(targetRole)) {
    return { allowed: true };
  }

  const movingIntoFullSeat =
    FULL_SEAT_ROLES.has(targetRole) && !FULL_SEAT_ROLES.has(currentRole ?? '');
  const movingIntoLightSeat =
    LIGHT_AGENT_ROLES.has(targetRole) && !LIGHT_AGENT_ROLES.has(currentRole ?? '');

  if (movingIntoFullSeat && currentFullSeats >= maxFullSeats) {
    return {
      allowed: false,
      reason: `Full seat limit reached (${currentFullSeats}/${maxFullSeats}). Upgrade your plan or use light_agent/collaborator roles.`,
      currentFullSeats,
      maxFullSeats,
    };
  }

  if (movingIntoLightSeat && currentLightSeats >= maxLightSeats) {
    return {
      allowed: false,
      reason: `Light agent seat limit reached (${currentLightSeats}/${maxLightSeats}).`,
      currentLightSeats,
      maxLightSeats,
    };
  }

  return {
    allowed: true,
    currentFullSeats,
    currentLightSeats,
    maxFullSeats,
    maxLightSeats,
  };
}

/**
 * Check if a workspace can add/change a user to the given role
 * based on billing plan seat limits.
 *
 * Pass `currentRole` when changing an EXISTING user's role so a seat-neutral
 * re-role within the same seat class is not rejected at the cap. Omit it for
 * brand-new users (invites), where the role is always a fresh seat.
 */
export async function checkSeatAvailability(
  workspaceId: string,
  tenantId: string,
  targetRole: string,
  currentRole?: string,
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

    return evaluateSeatDecision({
      currentFullSeats,
      currentLightSeats,
      maxFullSeats: limits.maxFullSeats,
      maxLightSeats: limits.maxLightSeats,
      targetRole,
      currentRole,
    });
  } catch {
    // On error, allow (don't block operations due to billing check failures)
    return { allowed: true };
  }
}

export function getPlanSeatLimits(plan: string): { maxFullSeats: number; maxLightSeats: number } {
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
