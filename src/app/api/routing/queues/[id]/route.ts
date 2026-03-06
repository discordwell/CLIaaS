import { NextRequest, NextResponse } from 'next/server';
import { getRoutingQueue, updateRoutingQueue, deleteRoutingQueue } from '@/lib/routing/store';
import { requireScope } from '@/lib/api-auth';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireScope(request, 'routing:read');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const queue = getRoutingQueue(id);
  if (!queue) return NextResponse.json({ error: 'Queue not found' }, { status: 404 });
  return NextResponse.json(queue);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireScope(request, 'routing:write');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const updated = updateRoutingQueue(id, body);
  if (!updated) return NextResponse.json({ error: 'Queue not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireScope(request, 'routing:write');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const deleted = deleteRoutingQueue(id);
  if (!deleted) return NextResponse.json({ error: 'Queue not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
