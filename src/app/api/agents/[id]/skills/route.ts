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
  const rawSkills = Array.isArray(body.skills) ? body.skills : [];
  const skillInputs = rawSkills.flatMap((skill): Array<{ skillName: string; proficiency?: number }> => {
    if (typeof skill === 'string') return [{ skillName: skill }];
    if (!skill || typeof skill !== 'object') return [];
    const candidate = skill as Record<string, unknown>;
    if (typeof candidate.skillName !== 'string') return [];
    return [{
      skillName: candidate.skillName,
      ...(typeof candidate.proficiency === 'number' ? { proficiency: candidate.proficiency } : {}),
    }];
  });
  const skills = setAgentSkills(id, (body.workspaceId as string) ?? '', skillInputs);
  return NextResponse.json(skills, { status: 201 });
}
