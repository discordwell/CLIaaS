import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { requirePermission } from '@/lib/rbac/check';
import { isRbacEnabled } from '@/lib/rbac/feature-flag';
import { BUILTIN_ROLE_MATRIX, PERMISSION_LABELS, PERMISSION_CATEGORIES } from '@/lib/rbac/constants';
import type { BuiltinRole } from '@/lib/rbac/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/roles/[role]/permissions — List permissions for a specific built-in role.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ role: string }> },
) {
  const auth = isRbacEnabled()
    ? await requirePermission(request, 'admin:roles')
    : await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { role } = await params;
  const perms = BUILTIN_ROLE_MATRIX[role as BuiltinRole];
  if (!perms) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 });
  }

  const permissions = perms.map(key => ({
    key,
    label: PERMISSION_LABELS[key] ?? key,
    category: PERMISSION_CATEGORIES[key] ?? 'other',
  }));

  return NextResponse.json({ role, permissions });
}
