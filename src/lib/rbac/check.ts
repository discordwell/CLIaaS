/**
 * Route-level RBAC permission guards.
 *
 * When RBAC_ENABLED=false, these fall through to the legacy
 * requireRole/requireScope behaviour.
 *
 * When RBAC_ENABLED=true, they check the x-user-permissions
 * bitfield header set by middleware.
 */

import { NextResponse } from 'next/server';
import { isRbacEnabled } from './feature-flag';
import { parseBitfield, hasPermission, hasAnyPermission as _hasAny } from './bitfield';
import { requireAuth, type AuthSuccess, type AuthError } from '@/lib/api-auth';

/**
 * Require a specific permission.
 * Falls through to requireAuth when RBAC is disabled.
 */
export async function requirePermission(
  request: Request,
  permission: string,
): Promise<AuthSuccess | AuthError> {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth;

  if (!isRbacEnabled()) return auth;

  const bitfield = parseBitfield(request.headers.get('x-user-permissions'));
  if (bitfield === BigInt(0)) {
    // No bitfield in headers — old JWT without permissions claim.
    // Default-deny: recompute from the user's role on the fly.
    const { resolveAndCheck } = await import('./permissions');
    const role = (auth as AuthSuccess).user?.role ?? 'viewer';
    const resolved = await resolveAndCheck(role, permission);
    if (!resolved) {
      return {
        error: NextResponse.json(
          { error: 'Insufficient permissions' },
          { status: 403 },
        ),
      };
    }
    return auth;
  }

  if (!hasPermission(bitfield, permission)) {
    return {
      error: NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 },
      ),
    };
  }

  return auth;
}

/**
 * Require ANY of the given permissions (OR logic).
 */
export async function requireAnyPermission(
  request: Request,
  permissions: string[],
): Promise<AuthSuccess | AuthError> {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth;

  if (!isRbacEnabled()) return auth;

  const bitfield = parseBitfield(request.headers.get('x-user-permissions'));
  if (bitfield === BigInt(0)) {
    const { resolveAndCheckAny } = await import('./permissions');
    const role = (auth as AuthSuccess).user?.role ?? 'viewer';
    const resolved = await resolveAndCheckAny(role, permissions);
    if (!resolved) {
      return {
        error: NextResponse.json(
          { error: 'Insufficient permissions' },
          { status: 403 },
        ),
      };
    }
    return auth;
  }

  if (!_hasAny(bitfield, permissions)) {
    return {
      error: NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 },
      ),
    };
  }

  return auth;
}
