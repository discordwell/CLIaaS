import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const { db } = await import('@/db');
  const schema = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const rows = await db
    .select()
    .from(schema.rules)
    .where(eq(schema.rules.id, id))
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
  const { id } = await params;
  const body = await request.json();

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const { db } = await import('@/db');
  const schema = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.conditions !== undefined) updates.conditions = body.conditions;
  if (body.actions !== undefined) updates.actions = body.actions;

  const [updated] = await db
    .update(schema.rules)
    .set(updates)
    .where(eq(schema.rules.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }

  return NextResponse.json({ rule: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const { db } = await import('@/db');
  const schema = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const [deleted] = await db
    .delete(schema.rules)
    .where(eq(schema.rules.id, id))
    .returning({ id: schema.rules.id });

  if (!deleted) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
