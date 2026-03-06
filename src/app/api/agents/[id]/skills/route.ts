import { NextRequest, NextResponse } from 'next/server';
import { getAgentSkills, setAgentSkills } from '@/lib/routing/store';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(getAgentSkills(id));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const skills = setAgentSkills(id, body.workspaceId ?? '', body.skills ?? []);
  return NextResponse.json(skills, { status: 201 });
}
