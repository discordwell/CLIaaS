import { NextRequest, NextResponse } from 'next/server';
import { getAgentSkills } from '@/lib/routing/store';
import { requireAuth } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  return NextResponse.json(getAgentSkills());
}
