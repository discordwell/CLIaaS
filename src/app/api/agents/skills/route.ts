import { NextRequest, NextResponse } from 'next/server';
import { getAgentSkills } from '@/lib/routing/store';
import { requirePerm } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  return NextResponse.json(getAgentSkills());
}
