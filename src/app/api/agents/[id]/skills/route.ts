import { NextRequest, NextResponse } from 'next/server';
import { getAgentSkills, setAgentSkills } from '@/lib/routing/store';
import { requirePerm } from '@/lib/rbac';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  return NextResponse.json(getAgentSkills(id));
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
  const skills = setAgentSkills(id, (body.workspaceId as string) ?? '', (body.skills as string[]) ?? []);
  return NextResponse.json(skills, { status: 201 });
}
