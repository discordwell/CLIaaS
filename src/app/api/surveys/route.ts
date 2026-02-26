import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { surveySubmitted } from '@/lib/events';
import { parseJsonBody } from '@/lib/parse-json-body';
import type { SurveyType } from '@/lib/data-provider/types';

export const dynamic = 'force-dynamic';

// Rating range validation per survey type
const RATING_RANGES: Record<SurveyType, { min: number; max: number }> = {
  csat: { min: 1, max: 5 },
  nps: { min: 0, max: 10 },
  ces: { min: 1, max: 7 },
};

// In-memory store for demo mode
const demoResponses: Array<{
  id: string;
  ticketId?: string;
  surveyType: SurveyType;
  rating: number;
  comment?: string;
  createdAt: string;
}> = [];

/**
 * POST /api/surveys — submit a survey response
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody<{
      ticketId?: string;
      surveyType?: string;
      rating?: number;
      comment?: string;
      token?: string;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { ticketId, surveyType, rating, comment, token } = parsed.data;

    if (!surveyType || !['csat', 'nps', 'ces'].includes(surveyType)) {
      return NextResponse.json(
        { error: 'surveyType must be one of: csat, nps, ces' },
        { status: 400 },
      );
    }

    const type = surveyType as SurveyType;
    const range = RATING_RANGES[type];

    if (rating === undefined || rating === null || !Number.isInteger(rating) || rating < range.min || rating > range.max) {
      return NextResponse.json(
        { error: `rating must be an integer between ${range.min} and ${range.max} for ${type}` },
        { status: 400 },
      );
    }

    // Try DB
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        // If token provided, update existing pending response
        if (token) {
          const existing = await db
            .select({ id: schema.surveyResponses.id })
            .from(schema.surveyResponses)
            .where(eq(schema.surveyResponses.token, token))
            .limit(1);

          if (existing.length > 0) {
            await db
              .update(schema.surveyResponses)
              .set({ rating, comment: comment ?? null })
              .where(eq(schema.surveyResponses.token, token));

            surveySubmitted({ surveyType: type, ticketId, rating, comment: comment ?? null });
            return NextResponse.json({ ok: true, updated: true });
          }
        }

        // Get workspace
        const workspaces = await db
          .select({ id: schema.workspaces.id })
          .from(schema.workspaces)
          .limit(1);
        const workspaceId = workspaces[0]?.id;
        if (!workspaceId) {
          return NextResponse.json({ error: 'No workspace configured' }, { status: 500 });
        }

        const [row] = await db
          .insert(schema.surveyResponses)
          .values({
            workspaceId,
            ticketId: ticketId ?? null,
            surveyType: type,
            rating,
            comment: comment ?? null,
            token: token ?? null,
          })
          .returning({ id: schema.surveyResponses.id });

        surveySubmitted({ surveyType: type, ticketId, rating, comment: comment ?? null, id: row.id });
        return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
      } catch {
        // DB unavailable, fall through to demo mode
      }
    }

    // Demo mode
    const id = `survey-${Date.now()}`;
    demoResponses.push({
      id,
      ticketId,
      surveyType: type,
      rating,
      comment: comment ?? undefined,
      createdAt: new Date().toISOString(),
    });

    surveySubmitted({ surveyType: type, ticketId, rating, comment: comment ?? null, id });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to submit survey' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/surveys?type=nps|ces|csat — aggregated stats per survey type
 */
export async function GET(request: NextRequest) {
  try {
    const typeParam = request.nextUrl.searchParams.get('type');
    if (!typeParam || !['csat', 'nps', 'ces'].includes(typeParam)) {
      return NextResponse.json(
        { error: 'type query param required: csat, nps, or ces' },
        { status: 400 },
      );
    }

    const type = typeParam as SurveyType;

    // Try DB
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq, and, isNotNull } = await import('drizzle-orm');

        const rows = await db
          .select({
            rating: schema.surveyResponses.rating,
          })
          .from(schema.surveyResponses)
          .where(and(
            eq(schema.surveyResponses.surveyType, type),
            isNotNull(schema.surveyResponses.rating),
          ));

        const ratings = rows
          .map((r: { rating: number | null }) => r.rating)
          .filter((r): r is number => r !== null);

        return NextResponse.json(computeStats(type, ratings));
      } catch {
        // DB unavailable, fall through
      }
    }

    // Demo mode
    const ratings = demoResponses
      .filter(r => r.surveyType === type)
      .map(r => r.rating);

    return NextResponse.json(computeStats(type, ratings));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load stats' },
      { status: 500 },
    );
  }
}

function computeStats(type: SurveyType, ratings: number[]) {
  const totalResponses = ratings.length;

  if (totalResponses === 0) {
    if (type === 'nps') {
      return { type, totalResponses: 0, npsScore: 0, promoters: 0, passives: 0, detractors: 0 };
    }
    if (type === 'ces') {
      return { type, totalResponses: 0, avgEffort: 0, lowEffort: 0, highEffort: 0 };
    }
    return {
      type, totalResponses: 0, averageRating: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, satisfactionPercent: 0,
    };
  }

  if (type === 'nps') {
    let promoters = 0;
    let passives = 0;
    let detractors = 0;
    for (const r of ratings) {
      if (r >= 9) promoters++;
      else if (r >= 7) passives++;
      else detractors++;
    }
    const npsScore = Math.round(((promoters - detractors) / totalResponses) * 100);
    return { type, totalResponses, npsScore, promoters, passives, detractors };
  }

  if (type === 'ces') {
    const sum = ratings.reduce((a, b) => a + b, 0);
    const avgEffort = Math.round((sum / totalResponses) * 100) / 100;
    const lowEffort = ratings.filter(r => r <= 3).length;
    const highEffort = ratings.filter(r => r >= 5).length;
    return { type, totalResponses, avgEffort, lowEffort, highEffort };
  }

  // CSAT
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of ratings) {
    distribution[r] = (distribution[r] ?? 0) + 1;
    sum += r;
  }
  const averageRating = Math.round((sum / totalResponses) * 100) / 100;
  const satisfied = (distribution[4] ?? 0) + (distribution[5] ?? 0);
  const satisfactionPercent = Math.round((satisfied / totalResponses) * 10000) / 100;

  return { type, totalResponses, averageRating, distribution, satisfactionPercent };
}
