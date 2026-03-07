import { NextResponse } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { PERMISSION_KEYS } from '@/lib/rbac/constants';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_KEYS = new Set(PERMISSION_KEYS);

/**
 * GET /api/roles/custom/[id]/permissions — Get permission overrides for a custom role.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid role ID' }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ permissions: [] });
  }

  try {
    const { db } = await import('@/db');
    const { customRolePermissions, customRoles } = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    // Verify the custom role belongs to the caller's workspace
    const [role] = await db
      .select({ id: customRoles.id })
      .from(customRoles)
      .where(and(eq(customRoles.id, id), eq(customRoles.workspaceId, auth.user.workspaceId)))
      .limit(1);

    if (!role) {
      return NextResponse.json({ error: 'Custom role not found' }, { status: 404 });
    }

    const rows = await db
      .select({
        permissionKey: customRolePermissions.permissionKey,
        granted: customRolePermissions.granted,
      })
      .from(customRolePermissions)
      .where(eq(customRolePermissions.customRoleId, id));

    return NextResponse.json({ permissions: rows });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err, 'Failed') }, { status: 500 });
  }
}

/**
 * PUT /api/roles/custom/[id]/permissions — Set permission overrides for a custom role.
 * Body: { permissions: [{ key: string, granted: boolean }] }
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid role ID' }, { status: 400 });
  }

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  const { permissions } = parsed.data;
  if (!Array.isArray(permissions)) {
    return NextResponse.json({ error: 'permissions must be an array' }, { status: 400 });
  }

  // Validate all keys
  for (const p of permissions) {
    if (!p.key || !VALID_KEYS.has(p.key)) {
      return NextResponse.json({ error: `Invalid permission key: ${p.key}` }, { status: 400 });
    }
    if (typeof p.granted !== 'boolean') {
      return NextResponse.json({ error: `granted must be boolean for ${p.key}` }, { status: 400 });
    }
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database required' }, { status: 503 });
  }

  try {
    const { db } = await import('@/db');
    const { customRolePermissions, customRoles } = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    // Verify the custom role exists and belongs to this workspace
    const [role] = await db
      .select({ id: customRoles.id })
      .from(customRoles)
      .where(and(eq(customRoles.id, id), eq(customRoles.workspaceId, auth.user.workspaceId)))
      .limit(1);

    if (!role) {
      return NextResponse.json({ error: 'Custom role not found' }, { status: 404 });
    }

    // Atomic delete + re-insert in a transaction
    await db.transaction(async (tx) => {
      await tx.delete(customRolePermissions).where(eq(customRolePermissions.customRoleId, id));

      if (permissions.length > 0) {
        await tx.insert(customRolePermissions).values(
          permissions.map((p: { key: string; granted: boolean }) => ({
            customRoleId: id,
            permissionKey: p.key,
            granted: p.granted,
          })),
        );
      }
    });

    return NextResponse.json({ updated: true, count: permissions.length });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err, 'Failed') }, { status: 500 });
  }
}
