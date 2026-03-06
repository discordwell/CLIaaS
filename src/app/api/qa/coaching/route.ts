import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getCoachingAssignments, createCoachingAssignment } from '@/lib/qa/qa-coaching-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/qa/coaching — list coaching assignments
 */
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'qa:review');
  if ('error' in auth) return auth.error;

  const wsId = auth.user.workspaceId ?? 'default';
  const agentId = request.nextUrl.searchParams.get('agentId') ?? undefined;
  const status = request.nextUrl.searchParams.get('status') ?? undefined;

  const assignments = getCoachingAssignments({ workspaceId: wsId, agentId, status });
  return NextResponse.json({ assignments, total: assignments.length });
}

/**
 * POST /api/qa/coaching — create coaching assignment
 */
export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'qa:review');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    reviewId?: string;
    agentId?: string;
    notes?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { reviewId, agentId, notes } = parsed.data;
  if (!reviewId || !agentId) {
    return NextResponse.json({ error: 'reviewId and agentId are required' }, { status: 400 });
  }

  const assignment = createCoachingAssignment({
    workspaceId: auth.user.workspaceId ?? 'default',
    reviewId,
    agentId,
    assignedBy: auth.user.id,
    notes,
  });

  return NextResponse.json({ assignment }, { status: 201 });
}
