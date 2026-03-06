import { NextRequest, NextResponse } from 'next/server';
import { getRoutingRule, updateRoutingRule, deleteRoutingRule } from '@/lib/routing/store';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rule = getRoutingRule(id);
  if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  return NextResponse.json(rule);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const updated = updateRoutingRule(id, body);
  if (!updated) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deleted = deleteRoutingRule(id);
  if (!deleted) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
