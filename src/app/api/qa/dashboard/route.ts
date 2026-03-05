import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getQADashboard } from '@/lib/qa/qa-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/qa/dashboard — QA dashboard metrics
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const dashboard = getQADashboard();
  return NextResponse.json(dashboard);
}
