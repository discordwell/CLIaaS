import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getCannedResponse, updateCannedResponse, deleteCannedResponse } from '@/lib/canned/canned-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const [row] = await db.select().from(schema.cannedResponses)
        .where(and(eq(schema.cannedResponses.id, id), eq(schema.cannedResponses.workspaceId, auth.user.workspaceId)))
        .limit(1);
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ cannedResponse: row });
    }

    const cr = getCannedResponse(id);
    if (!cr) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ cannedResponse: cr });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:reply_public');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  const parsed = await parseJsonBody<{
    title?: string; body?: string; category?: string; scope?: 'personal' | 'shared'; shortcut?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.title !== undefined) set.title = parsed.data.title;
      if (parsed.data.body !== undefined) set.body = parsed.data.body;
      if (parsed.data.category !== undefined) set.category = parsed.data.category;
      if (parsed.data.scope !== undefined) set.scope = parsed.data.scope;
      if (parsed.data.shortcut !== undefined) set.shortcut = parsed.data.shortcut;

      const [row] = await db.update(schema.cannedResponses).set(set)
        .where(and(eq(schema.cannedResponses.id, id), eq(schema.cannedResponses.workspaceId, auth.user.workspaceId)))
        .returning();
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ cannedResponse: row });
    }

    const updated = updateCannedResponse(id, parsed.data);
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ cannedResponse: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:reply_public');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const [deleted] = await db.delete(schema.cannedResponses)
        .where(and(eq(schema.cannedResponses.id, id), eq(schema.cannedResponses.workspaceId, auth.user.workspaceId)))
        .returning({ id: schema.cannedResponses.id });
      if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ deleted: true });
    }

    const ok = deleteCannedResponse(id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
