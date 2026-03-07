import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { getMacro, updateMacro, deleteMacro, type MacroAction } from '@/lib/canned/macro-store';

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

      const [row] = await db.select().from(schema.nativeMacros)
        .where(and(eq(schema.nativeMacros.id, id), eq(schema.nativeMacros.workspaceId, auth.user.workspaceId)))
        .limit(1);
      if (!row) return NextResponse.json({ error: 'Macro not found' }, { status: 404 });
      return NextResponse.json({ macro: row });
    }

    const macro = getMacro(id);
    if (!macro) return NextResponse.json({ error: 'Macro not found' }, { status: 404 });
    return NextResponse.json({ macro });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err, 'Failed') }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  const parsed = await parseJsonBody<{
    name?: string; description?: string; actions?: unknown[]; scope?: 'personal' | 'shared'; enabled?: boolean; position?: number;
  }>(request);
  if ('error' in parsed) return parsed.error;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.name !== undefined) set.name = parsed.data.name;
      if (parsed.data.description !== undefined) set.description = parsed.data.description;
      if (parsed.data.actions !== undefined) set.actions = parsed.data.actions;
      if (parsed.data.scope !== undefined) set.scope = parsed.data.scope;
      if (parsed.data.enabled !== undefined) set.enabled = parsed.data.enabled;
      if (parsed.data.position !== undefined) set.position = parsed.data.position;

      const [row] = await db.update(schema.nativeMacros).set(set)
        .where(and(eq(schema.nativeMacros.id, id), eq(schema.nativeMacros.workspaceId, auth.user.workspaceId)))
        .returning();
      if (!row) return NextResponse.json({ error: 'Macro not found' }, { status: 404 });
      return NextResponse.json({ macro: row });
    }

    const updated = updateMacro(id, {
      ...parsed.data,
      actions: parsed.data.actions as MacroAction[] | undefined,
    });
    if (!updated) return NextResponse.json({ error: 'Macro not found' }, { status: 404 });
    return NextResponse.json({ macro: updated });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err, 'Failed') }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const [deleted] = await db.delete(schema.nativeMacros)
        .where(and(eq(schema.nativeMacros.id, id), eq(schema.nativeMacros.workspaceId, auth.user.workspaceId)))
        .returning({ id: schema.nativeMacros.id });
      if (!deleted) return NextResponse.json({ error: 'Macro not found' }, { status: 404 });
      return NextResponse.json({ deleted: true });
    }

    const ok = deleteMacro(id);
    if (!ok) return NextResponse.json({ error: 'Macro not found' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err, 'Failed') }, { status: 500 });
  }
}
