import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { requirePermission } from '@/lib/rbac/check';
import { isRbacEnabled } from '@/lib/rbac/feature-flag';
import { BUILTIN_ROLE_MATRIX, PERMISSION_KEYS } from '@/lib/rbac/constants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/roles — List all built-in roles with their permission counts.
 * Requires admin:roles when RBAC is enabled, otherwise requireAuth.
 */
export async function GET(request: Request) {
  const auth = isRbacEnabled()
    ? await requirePermission(request, 'admin:roles')
    : await requireAuth(request);
  if ('error' in auth) return auth.error;

  const roles = Object.entries(BUILTIN_ROLE_MATRIX).map(([role, perms]) => ({
    role,
    permissionCount: perms.length,
    totalPermissions: PERMISSION_KEYS.length,
    isBuiltin: true,
  }));

  return NextResponse.json({ roles });
}
