import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getSignature, updateSignature, deleteSignature } from '@/lib/canned/signature-store';

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

      const [row] = await db.select().from(schema.agentSignatures)
        .where(and(eq(schema.agentSignatures.id, id), eq(schema.agentSignatures.workspaceId, auth.user.workspaceId)))
        .limit(1);
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ signature: row });
    }

    const sig = getSignature(id);
    if (!sig) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ signature: sig });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  const parsed = await parseJsonBody<{
    name?: string; bodyHtml?: string; bodyText?: string; isDefault?: boolean;
  }>(request);
  if ('error' in parsed) return parsed.error;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      if (parsed.data.isDefault) {
        await db.update(schema.agentSignatures)
          .set({ isDefault: false })
          .where(and(
            eq(schema.agentSignatures.workspaceId, auth.user.workspaceId),
            eq(schema.agentSignatures.userId, auth.user.id),
            eq(schema.agentSignatures.isDefault, true),
          ));
      }

      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.name !== undefined) set.name = parsed.data.name;
      if (parsed.data.bodyHtml !== undefined) set.bodyHtml = parsed.data.bodyHtml;
      if (parsed.data.bodyText !== undefined) set.bodyText = parsed.data.bodyText;
      if (parsed.data.isDefault !== undefined) set.isDefault = parsed.data.isDefault;

      const [row] = await db.update(schema.agentSignatures).set(set)
        .where(and(eq(schema.agentSignatures.id, id), eq(schema.agentSignatures.workspaceId, auth.user.workspaceId)))
        .returning();
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ signature: row });
    }

    const updated = updateSignature(id, parsed.data);
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ signature: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

export async function DELETE(
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

      const [deleted] = await db.delete(schema.agentSignatures)
        .where(and(eq(schema.agentSignatures.id, id), eq(schema.agentSignatures.workspaceId, auth.user.workspaceId)))
        .returning({ id: schema.agentSignatures.id });
      if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ deleted: true });
    }

    const ok = deleteSignature(id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
