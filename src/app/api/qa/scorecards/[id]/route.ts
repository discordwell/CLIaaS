import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { updateScorecard, getScorecard } from '@/lib/qa/qa-store';
import type { ScorecardCriterion } from '@/lib/qa/qa-store';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/qa/scorecards/:id — update a QA scorecard
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'qa:review');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const existing = getScorecard(id);
  if (!existing) {
    return NextResponse.json({ error: 'Scorecard not found' }, { status: 404 });
  }

  const parsed = await parseJsonBody<{
    name?: string;
    criteria?: ScorecardCriterion[];
    enabled?: boolean;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const updated = updateScorecard(id, parsed.data);
  if (!updated) {
    return NextResponse.json({ error: 'Scorecard not found' }, { status: 404 });
  }

  return NextResponse.json({ scorecard: updated });
}
