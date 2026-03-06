import { NextRequest, NextResponse } from 'next/server';
import { getGroupMemberships, addGroupMember, removeGroupMember } from '@/lib/routing/store';
import { requirePerm } from '@/lib/rbac';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, 'admin:users', 'agent');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  return NextResponse.json(getGroupMemberships(id));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, 'admin:users', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.userId || typeof body.userId !== 'string') {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  const membership = addGroupMember((body.workspaceId as string) ?? '', id, body.userId);
  return NextResponse.json(membership, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, 'admin:users', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.userId || typeof body.userId !== 'string') {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  const removed = removeGroupMember(id, body.userId);
  if (!removed) return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
