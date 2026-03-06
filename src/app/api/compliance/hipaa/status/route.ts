import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { evaluateHipaaReadiness, getHipaaScore } from '@/lib/compliance/hipaa';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const controls = await evaluateHipaaReadiness(auth.user.workspaceId);
    const score = getHipaaScore(controls);

    return NextResponse.json({ controls, score });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to evaluate HIPAA readiness' },
      { status: 500 },
    );
  }
}
