import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requirePerm(request, 'tickets:view');
  if ('error' in authResult) return authResult.error;

  const { id } = await params;

  try {
    const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers');
    const conn = await tryDb();

    if (conn) {
      const { eq, and } = await import('drizzle-orm');
      const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
      const [row] = await conn.db
        .select()
        .from(conn.schema.views)
        .where(and(eq(conn.schema.views.id, id), eq(conn.schema.views.workspaceId, wsId)))
        .limit(1);

      if (!row) return NextResponse.json({ error: 'View not found' }, { status: 404 });
      if ((row as Record<string, unknown>).viewType === 'personal' && (row as Record<string, unknown>).userId !== authResult.user.id) {
        return NextResponse.json({ error: 'View not found' }, { status: 404 });
      }
      return NextResponse.json({ view: row });
    }

    const { getView } = await import('@/lib/views/store');
    const view = getView(id);
    if (!view) return NextResponse.json({ error: 'View not found' }, { status: 404 });
    return NextResponse.json({ view });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get view' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requirePerm(request, 'tickets:view');
  if ('error' in authResult) return authResult.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{
    name?: string;
    description?: string;
    query?: unknown;
    active?: boolean;
    position?: number;
  }>(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers');
    const conn = await tryDb();

    if (conn) {
      const { eq, and, ne } = await import('drizzle-orm');
      const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

      // Prevent modifying system views and enforce personal view ownership
      const [existing] = await conn.db
        .select({ viewType: conn.schema.views.viewType, userId: conn.schema.views.userId })
        .from(conn.schema.views)
        .where(and(eq(conn.schema.views.id, id), eq(conn.schema.views.workspaceId, wsId)))
        .limit(1);

      if (!existing) return NextResponse.json({ error: 'View not found' }, { status: 404 });
      if (existing.viewType === 'system') {
        return NextResponse.json({ error: 'Cannot modify system views' }, { status: 403 });
      }
      if (existing.viewType === 'personal' && existing.userId !== authResult.user.id) {
        return NextResponse.json({ error: 'View not found' }, { status: 404 });
      }

      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.name !== undefined) set.name = parsed.data.name;
      if (parsed.data.description !== undefined) set.description = parsed.data.description;
      if (parsed.data.query !== undefined) set.query = parsed.data.query;
      if (parsed.data.active !== undefined) set.active = parsed.data.active;
      if (parsed.data.position !== undefined) set.position = parsed.data.position;

      const [updated] = await conn.db
        .update(conn.schema.views)
        .set(set)
        .where(and(eq(conn.schema.views.id, id), eq(conn.schema.views.workspaceId, wsId)))
        .returning();

      if (!updated) return NextResponse.json({ error: 'View not found' }, { status: 404 });
      return NextResponse.json({ view: updated });
    }

    const { updateView } = await import('@/lib/views/store');
    const view = updateView(id, parsed.data);
    if (!view) return NextResponse.json({ error: 'View not found or system view' }, { status: 404 });
    return NextResponse.json({ view });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update view' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requirePerm(request, 'tickets:view');
  if ('error' in authResult) return authResult.error;

  const { id } = await params;

  try {
    const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers');
    const conn = await tryDb();

    if (conn) {
      const { eq, and, ne } = await import('drizzle-orm');
      const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

      // Prevent deleting system views
      const [deleted] = await conn.db
        .delete(conn.schema.views)
        .where(and(
          eq(conn.schema.views.id, id),
          eq(conn.schema.views.workspaceId, wsId),
          ne(conn.schema.views.viewType, 'system'),
        ))
        .returning({ id: conn.schema.views.id });

      if (!deleted) return NextResponse.json({ error: 'View not found or system view' }, { status: 404 });
      return NextResponse.json({ deleted: true });
    }

    const { deleteView } = await import('@/lib/views/store');
    if (!deleteView(id)) return NextResponse.json({ error: 'View not found or system view' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete view' },
      { status: 500 },
    );
  }
}
