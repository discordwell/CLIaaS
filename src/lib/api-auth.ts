/**
 * Route-level authentication & authorization helpers.
 *
 * These read the identity headers set by middleware (x-user-id, x-user-role, etc.)
 * rather than re-verifying the JWT. In demo mode (no DATABASE_URL), a default
 * admin user is returned so all guards pass.
 *
 * API key authentication is handled via the x-auth-type header set by middleware.
 * When x-auth-type is 'api-key', the Authorization bearer token is validated
 * against the api_keys table instead of reading identity headers.
 */

import { NextResponse } from 'next/server';

export type Role = 'owner' | 'admin' | 'agent';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  workspaceId: string;
  authType?: 'session' | 'api-key';
  name?: string;
  tenantId?: string;
  scopes?: string[];
}

const DEMO_USER: AuthUser = {
  id: 'demo-user',
  email: 'demo@cliaas.local',
  role: 'admin',
  workspaceId: 'demo-workspace',
  authType: 'session',
};

export const ROLE_HIERARCHY: Record<Role, number> = {
  owner: 3,
  admin: 2,
  agent: 1,
};

/**
 * Extract the authenticated user from middleware-set request headers.
 * Returns DEMO_USER when no DATABASE_URL (demo mode).
 * Returns null if headers are missing (should not happen behind middleware).
 *
 * When x-auth-type is 'api-key', validates the bearer token via api-keys service.
 */
export async function getAuthUser(request: Request): Promise<AuthUser | null> {
  if (!process.env.DATABASE_URL) {
    return DEMO_USER;
  }

  // API key authentication path
  const authType = request.headers.get('x-auth-type');
  if (authType === 'api-key') {
    const authHeader = request.headers.get('authorization') || '';
    const rawKey = authHeader.replace(/^Bearer\s+/i, '');
    if (!rawKey) return null;

    try {
      const { validateApiKey } = await import('@/lib/api-keys');
      return await validateApiKey(rawKey);
    } catch {
      return null;
    }
  }

  // Session-based authentication path (JWT headers from middleware)
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
    tenantId: request.headers.get('x-tenant-id') || undefined,
    authType: 'session',
  };
}

export type AuthSuccess = { user: AuthUser };
export type AuthError = { error: NextResponse };

/**
 * Require an authenticated user. Returns the user or a 401 response.
 */
export async function requireAuth(request: Request): Promise<AuthSuccess | AuthError> {
  const user = await getAuthUser(request);
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
export async function requireRole(
  request: Request,
  minimumRole: Role,
): Promise<AuthSuccess | AuthError> {
  const auth = await requireAuth(request);
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

/**
 * Valid API key scopes. Used to validate scopes during key creation.
 */
export const VALID_SCOPES = [
  'tickets:read',
  'tickets:write',
  'kb:read',
  'kb:write',
  'analytics:read',
  'webhooks:read',
  'webhooks:write',
  'admin:*',
  '*',
] as const;

/**
 * Check whether a set of scopes satisfies a required scope.
 * Supports exact match, wildcard '*', and namespace wildcards like 'admin:*'.
 */
function scopeMatches(userScopes: string[], requiredScope: string): boolean {
  for (const s of userScopes) {
    if (s === '*') return true;
    if (s === requiredScope) return true;
    // Namespace wildcard: 'admin:*' matches 'admin:read', 'admin:write', etc.
    if (s.endsWith(':*')) {
      const namespace = s.slice(0, -1); // 'admin:'
      if (requiredScope.startsWith(namespace)) return true;
    }
  }
  return false;
}

/**
 * Require an authenticated user with a specific scope.
 * Session users always pass (implicit '*').
 * API key users must have the scope in their scopes array.
 */
export async function requireScope(
  request: Request,
  scope: string,
): Promise<AuthSuccess | AuthError> {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth;

  // Session-based auth always passes scope checks (implicit wildcard)
  if (auth.user.authType !== 'api-key') {
    return auth;
  }

  const userScopes = auth.user.scopes ?? [];
  if (!scopeMatches(userScopes, scope)) {
    return {
      error: NextResponse.json(
        { error: `API key does not have required scope: ${scope}` },
        { status: 403 },
      ),
    };
  }

  return auth;
}

/**
 * Require both a specific scope AND a minimum role in a single auth call.
 * Avoids the double-auth overhead of calling requireScope + requireRole separately.
 */
export async function requireScopeAndRole(
  request: Request,
  scope: string,
  minimumRole: Role,
): Promise<AuthSuccess | AuthError> {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth;

  // Check scope for API key users
  if (auth.user.authType === 'api-key') {
    const userScopes = auth.user.scopes ?? [];
    if (!scopeMatches(userScopes, scope)) {
      return {
        error: NextResponse.json(
          { error: `API key does not have required scope: ${scope}` },
          { status: 403 },
        ),
      };
    }
  }

  // Check role hierarchy
  const userLevel = ROLE_HIERARCHY[auth.user.role] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[minimumRole];
  if (userLevel < requiredLevel) {
    return {
      error: NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 },
      ),
    };
  }

  return auth;
}
