import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac/check';
import { requireAuth } from '@/lib/api-auth';
import { isRbacEnabled } from '@/lib/rbac/feature-flag';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/roles/custom/[id] — Update a custom role.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = isRbacEnabled()
    ? await requirePermission(request, 'admin:roles')
    : await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid role ID' }, { status: 400 });
  }

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  const { name, description } = parsed.data;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database required' }, { status: 503 });
  }

  try {
    const { db } = await import('@/db');
    const { customRoles } = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;

    const [updated] = await db
      .update(customRoles)
      .set(updates)
      .where(and(eq(customRoles.id, id), eq(customRoles.workspaceId, auth.user.workspaceId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Custom role not found' }, { status: 404 });
    }

    return NextResponse.json({ customRole: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

/**
 * DELETE /api/roles/custom/[id] — Delete a custom role.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = isRbacEnabled()
    ? await requirePermission(request, 'admin:roles')
    : await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid role ID' }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database required' }, { status: 503 });
  }

  try {
    const { db } = await import('@/db');
    const { customRoles } = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    const [deleted] = await db
      .delete(customRoles)
      .where(and(eq(customRoles.id, id), eq(customRoles.workspaceId, auth.user.workspaceId)))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'Custom role not found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
