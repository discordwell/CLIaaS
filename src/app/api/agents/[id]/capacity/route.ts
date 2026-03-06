import { NextRequest, NextResponse } from 'next/server';
import { getAgentCapacity, setAgentCapacity } from '@/lib/routing/store';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(getAgentCapacity(id));
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const caps = setAgentCapacity(id, body.workspaceId ?? '', body.rules ?? []);
  return NextResponse.json(caps);
}
