import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { requirePermission } from '@/lib/rbac/check';
import { isRbacEnabled } from '@/lib/rbac/feature-flag';
import { resolveUserPermissions, getUserBitfield } from '@/lib/rbac/permissions';
import { BUILTIN_ROLE_MATRIX } from '@/lib/rbac/constants';
import type { BuiltinRole } from '@/lib/rbac/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users/[id]/effective-permissions — Resolve the effective
 * permissions for a specific user (based on their role + custom role).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = isRbacEnabled()
    ? await requirePermission(request, 'admin:users')
    : await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id: userId } = await params;

  // Look up the user's role
  let role: string = 'agent';
  let customRoleId: string | null = null;

  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import('@/db');
      const { users } = await import('@/db/schema');
      const { eq } = await import('drizzle-orm');
      const [user] = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      role = user.role;
    } catch {
      // fall through with default role
    }
  }

  const permissions = await resolveUserPermissions(role, auth.user.workspaceId, customRoleId);
  const bitfield = await getUserBitfield(role, auth.user.workspaceId, customRoleId);

  return NextResponse.json({
    userId,
    role,
    customRoleId,
    permissions,
    bitfield: bitfield.toString(),
    totalPermissions: BUILTIN_ROLE_MATRIX[role as BuiltinRole]?.length ?? permissions.length,
  });
}
