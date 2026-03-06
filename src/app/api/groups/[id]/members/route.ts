import { NextRequest, NextResponse } from 'next/server';
import { getGroupMemberships, addGroupMember } from '@/lib/routing/store';
import { requireAuth, requireRole } from '@/lib/api-auth';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  return NextResponse.json(getGroupMemberships(id));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, 'admin');
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
