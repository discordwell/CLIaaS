/**
 * Route-level authentication & authorization helpers.
 *
 * These read the identity headers set by middleware (x-user-id, x-user-role, etc.)
 * rather than re-verifying the JWT. In demo mode (no DATABASE_URL), a default
 * admin user is returned so all guards pass.
 */

import { NextResponse } from 'next/server';

export type Role = 'owner' | 'admin' | 'agent';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  workspaceId: string;
}

const DEMO_USER: AuthUser = {
  id: 'demo-user',
  email: 'demo@cliaas.local',
  role: 'admin',
  workspaceId: 'demo-workspace',
};

const ROLE_HIERARCHY: Record<Role, number> = {
  owner: 3,
  admin: 2,
  agent: 1,
};

/**
 * Extract the authenticated user from middleware-set request headers.
 * Returns DEMO_USER when no DATABASE_URL (demo mode).
 * Returns null if headers are missing (should not happen behind middleware).
 */
export function getAuthUser(request: Request): AuthUser | null {
  if (!process.env.DATABASE_URL) {
    return DEMO_USER;
  }

  const id = request.headers.get('x-user-id');
  const workspaceId = request.headers.get('x-workspace-id');
  if (!id || !workspaceId) {
    return null;
  }

  return {
    id,
    email: request.headers.get('x-user-email') || '',
    role: (request.headers.get('x-user-role') || 'agent') as Role,
    workspaceId,
  };
}

type AuthSuccess = { user: AuthUser };
type AuthError = { error: NextResponse };

/**
 * Require an authenticated user. Returns the user or a 401 response.
 */
export function requireAuth(request: Request): AuthSuccess | AuthError {
  const user = getAuthUser(request);
  if (!user) {
    return {
      error: NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      ),
    };
  }
  return { user };
}

/**
 * Require a minimum role level. Returns the user or 401/403 response.
 * Role hierarchy: owner > admin > agent
 */
export function requireRole(
  request: Request,
  minimumRole: Role,
): AuthSuccess | AuthError {
  const auth = requireAuth(request);
  if ('error' in auth) return auth;

  const userLevel = ROLE_HIERARCHY[auth.user.role] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[minimumRole];

  if (userLevel < requiredLevel) {
    return {
      error: NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      ),
    };
  }

  return auth;
}
