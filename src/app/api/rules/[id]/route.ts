import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const { db } = await import('@/db');
  const schema = await import('@/db/schema');
  const { eq, and } = await import('drizzle-orm');

  // Scope by workspace to prevent cross-workspace data leakage
  const rows = await db
    .select()
    .from(schema.rules)
    .where(and(eq(schema.rules.id, id), eq(schema.rules.workspaceId, auth.user.workspaceId)))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }

  return NextResponse.json({ rule: rows[0] });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const { db } = await import('@/db');
  const schema = await import('@/db/schema');
  const { eq, and } = await import('drizzle-orm');

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.conditions !== undefined) updates.conditions = body.conditions;
  if (body.actions !== undefined) updates.actions = body.actions;

  // Scope by workspace to prevent cross-workspace modification
  const [updated] = await db
    .update(schema.rules)
    .set(updates)
    .where(and(eq(schema.rules.id, id), eq(schema.rules.workspaceId, auth.user.workspaceId)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }

  return NextResponse.json({ rule: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const { db } = await import('@/db');
  const schema = await import('@/db/schema');
  const { eq, and } = await import('drizzle-orm');

  // Scope by workspace to prevent cross-workspace deletion
  const [deleted] = await db
    .delete(schema.rules)
    .where(and(eq(schema.rules.id, id), eq(schema.rules.workspaceId, auth.user.workspaceId)))
    .returning({ id: schema.rules.id });

  if (!deleted) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
