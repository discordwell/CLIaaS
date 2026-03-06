import { NextRequest, NextResponse } from 'next/server';
import { getGroupMemberships, addGroupMember } from '@/lib/routing/store';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(getGroupMemberships(id));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const membership = addGroupMember(body.workspaceId ?? '', id, body.userId);
  return NextResponse.json(membership, { status: 201 });
}
