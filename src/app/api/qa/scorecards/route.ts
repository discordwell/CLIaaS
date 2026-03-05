import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getScorecards, createScorecard } from '@/lib/qa/qa-store';
import type { ScorecardCriterion } from '@/lib/qa/qa-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/qa/scorecards — list all QA scorecards
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const scorecards = getScorecards();
  return NextResponse.json({ scorecards });
}

/**
 * POST /api/qa/scorecards — create a QA scorecard
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name?: string;
    criteria?: ScorecardCriterion[];
    enabled?: boolean;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, criteria, enabled } = parsed.data;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  if (!criteria || !Array.isArray(criteria) || criteria.length === 0) {
    return NextResponse.json(
      { error: 'criteria is required and must be a non-empty array' },
      { status: 400 },
    );
  }

  const scorecard = createScorecard({
    name: name.trim(),
    criteria,
    enabled: enabled ?? true,
    workspaceId: auth.user.workspaceId,
  });

  return NextResponse.json({ scorecard }, { status: 201 });
}
