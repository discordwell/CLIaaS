import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getAccuracyStats } from '@/lib/predictions/csat-prediction-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/predictions/csat/accuracy — prediction accuracy report
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const wsId = auth.user.workspaceId ?? 'default';
  const stats = getAccuracyStats(wsId);
  return NextResponse.json(stats);
}
