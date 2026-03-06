import { NextRequest, NextResponse } from 'next/server';
import { getRoutingRule, updateRoutingRule, deleteRoutingRule } from '@/lib/routing/store';
import { requirePerm } from '@/lib/rbac';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const rule = getRoutingRule(id);
  if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  return NextResponse.json(rule);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const updated = updateRoutingRule(id, body);
  if (!updated) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const deleted = deleteRoutingRule(id);
  if (!deleted) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
