import { NextResponse } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { BUILTIN_ROLE_MATRIX, PERMISSION_KEYS } from '@/lib/rbac/constants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/roles — List all built-in roles with their permission counts.
 */
export async function GET(request: Request) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const roles = Object.entries(BUILTIN_ROLE_MATRIX).map(([role, perms]) => ({
    role,
    permissionCount: perms.length,
    totalPermissions: PERMISSION_KEYS.length,
    isBuiltin: true,
  }));

  return NextResponse.json({ roles });
}
