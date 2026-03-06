import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResult = await requirePerm(request, 'tickets:view');
  if ('error' in authResult) return authResult.error;

  try {
    const { tryDb } = await import('@/lib/store-helpers');
    const conn = await tryDb();
    if (!conn) return NextResponse.json({ tags: [] });

    const { getDefaultWorkspaceId } = await import('@/lib/store-helpers');
    const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

    const { eq, sql } = await import('drizzle-orm');
    const rows = await conn.db
      .select({
        id: conn.schema.tags.id,
        name: conn.schema.tags.name,
        color: conn.schema.tags.color,
        description: conn.schema.tags.description,
        createdAt: conn.schema.tags.createdAt,
        usageCount: sql<number>`(SELECT COUNT(*) FROM ticket_tags WHERE tag_id = ${conn.schema.tags.id})`.as('usage_count'),
      })
      .from(conn.schema.tags)
      .where(eq(conn.schema.tags.workspaceId, wsId))
      .orderBy(conn.schema.tags.name);

    return NextResponse.json({ tags: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load tags' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requirePerm(request, 'tickets:update_status');
  if ('error' in authResult) return authResult.error;

  const parsed = await parseJsonBody<{ name: string; color?: string; description?: string }>(request);
  if ('error' in parsed) return parsed.error;
  const { name, color, description } = parsed.data;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
  }
  if (color && !/^#[0-9a-fA-F]{3,8}$/.test(color)) {
    return NextResponse.json({ error: 'Invalid color format (expected hex, e.g. #ff0000)' }, { status: 400 });
  }

  try {
    const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers');
    const conn = await tryDb();
    if (!conn) return NextResponse.json({ error: 'DB not available' }, { status: 500 });

    const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

    const [row] = await conn.db
      .insert(conn.schema.tags)
      .values({
        workspaceId: wsId,
        name: name.trim(),
        color: color ?? '#71717a',
        description: description ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (!row) {
      // Already exists — return the existing tag
      const { eq, and } = await import('drizzle-orm');
      const [existing] = await conn.db
        .select()
        .from(conn.schema.tags)
        .where(and(eq(conn.schema.tags.workspaceId, wsId), eq(conn.schema.tags.name, name.trim())))
        .limit(1);
      return NextResponse.json({ tag: existing });
    }

    return NextResponse.json({ tag: row }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create tag' },
      { status: 500 },
    );
  }
}
