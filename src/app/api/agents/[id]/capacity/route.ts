import { NextRequest, NextResponse } from 'next/server';
import { getAgentCapacity, setAgentCapacity } from '@/lib/routing/store';
import { requireAuth, requireRole } from '@/lib/api-auth';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  return NextResponse.json(getAgentCapacity(id));
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const caps = setAgentCapacity(id, (body.workspaceId as string) ?? '', (body.rules as unknown[]) ?? []);
  return NextResponse.json(caps);
}
