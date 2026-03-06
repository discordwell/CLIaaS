import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireScope(request, 'tickets:write');
  if ('error' in authResult) return authResult.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{ name?: string; color?: string; description?: string }>(request);
  if ('error' in parsed) return parsed.error;
  const { name, color, description } = parsed.data;

  if (color !== undefined && !HEX_COLOR_RE.test(color)) {
    return NextResponse.json({ error: 'Invalid color format (expected hex, e.g. #ff0000)' }, { status: 400 });
  }

  try {
    const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers');
    const conn = await tryDb();
    if (!conn) return NextResponse.json({ error: 'DB not available' }, { status: 500 });

    const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
    const { eq, and } = await import('drizzle-orm');
    const set: Record<string, unknown> = {};
    if (name !== undefined) set.name = name.trim();
    if (color !== undefined) set.color = color;
    if (description !== undefined) set.description = description;

    if (Object.keys(set).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    const [updated] = await conn.db
      .update(conn.schema.tags)
      .set(set)
      .where(and(eq(conn.schema.tags.id, id), eq(conn.schema.tags.workspaceId, wsId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    return NextResponse.json({ tag: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update tag' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireScope(request, 'tickets:write');
  if ('error' in authResult) return authResult.error;

  const { id } = await params;

  try {
    const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers');
    const conn = await tryDb();
    if (!conn) return NextResponse.json({ error: 'DB not available' }, { status: 500 });

    const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
    const { eq, and } = await import('drizzle-orm');

    // Verify tag belongs to workspace, then delete refs + tag in a transaction
    const [tag] = await conn.db
      .select({ id: conn.schema.tags.id })
      .from(conn.schema.tags)
      .where(and(eq(conn.schema.tags.id, id), eq(conn.schema.tags.workspaceId, wsId)))
      .limit(1);

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    await conn.db.transaction(async (tx) => {
      await tx
        .delete(conn.schema.ticketTags)
        .where(eq(conn.schema.ticketTags.tagId, id));
      await tx
        .delete(conn.schema.tags)
        .where(eq(conn.schema.tags.id, id));
    });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete tag' },
      { status: 500 },
    );
  }
}
