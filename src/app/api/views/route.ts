import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import type { ViewQuery } from '@/lib/views/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResult = await requirePerm(request, 'tickets:view');
  if ('error' in authResult) return authResult.error;

  try {
    const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers');
    const conn = await tryDb();

    if (conn) {
      const { eq, and, or, ne, isNull } = await import('drizzle-orm');
      const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
      const userId = authResult.user.id;
      const rows = await conn.db
        .select()
        .from(conn.schema.views)
        .where(and(
          eq(conn.schema.views.workspaceId, wsId),
          or(
            ne(conn.schema.views.viewType, 'personal'),
            eq(conn.schema.views.userId, userId),
            isNull(conn.schema.views.userId),
          ),
        ))
        .orderBy(conn.schema.views.position);

      return NextResponse.json({
        views: rows.map((r: Record<string, unknown>) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          query: r.query,
          viewType: r.viewType ?? 'shared',
          userId: r.userId,
          active: r.active,
          position: r.position ?? 0,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
          updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
        })),
      });
    }

    // Fallback to in-memory store
    const { listViews } = await import('@/lib/views/store');
    return NextResponse.json({ views: listViews(authResult.user.id) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load views' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requirePerm(request, 'tickets:view');
  if ('error' in authResult) return authResult.error;

  const parsed = await parseJsonBody<{
    name: string;
    description?: string;
    query: ViewQuery;
    viewType?: 'shared' | 'personal';
  }>(request);
  if ('error' in parsed) return parsed.error;
  const { name, description, query, viewType } = parsed.data;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'View name is required' }, { status: 400 });
  }
  if (!query?.conditions) {
    return NextResponse.json({ error: 'View query is required' }, { status: 400 });
  }

  try {
    const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers');
    const conn = await tryDb();

    if (conn) {
      const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
      const [row] = await conn.db
        .insert(conn.schema.views)
        .values({
          workspaceId: wsId,
          userId: viewType === 'personal' ? authResult.user.id : null,
          name: name.trim(),
          description: description ?? null,
          query,
          viewType: viewType ?? 'shared',
          position: 0,
        })
        .returning();

      return NextResponse.json({ view: row }, { status: 201 });
    }

    const { createView } = await import('@/lib/views/store');
    const view = createView({
      name: name.trim(),
      description,
      query,
      viewType,
      userId: authResult.user.id,
    });
    return NextResponse.json({ view }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create view' },
      { status: 500 },
    );
  }
}
