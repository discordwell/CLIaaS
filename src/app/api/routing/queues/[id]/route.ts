import { NextRequest, NextResponse } from 'next/server';
import { getRoutingQueue, updateRoutingQueue, deleteRoutingQueue } from '@/lib/routing/store';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const queue = getRoutingQueue(id);
  if (!queue) return NextResponse.json({ error: 'Queue not found' }, { status: 404 });
  return NextResponse.json(queue);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const updated = updateRoutingQueue(id, body);
  if (!updated) return NextResponse.json({ error: 'Queue not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deleted = deleteRoutingQueue(id);
  if (!deleted) return NextResponse.json({ error: 'Queue not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
