import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';
import { analyzeContentGaps } from '@/lib/kb/content-gaps';

export const dynamic = 'force-dynamic';

/**
 * GET /api/kb/content-gaps
 * List content gaps for the workspace.
 * Auth required (kb:read).
 */
export async function GET(request: NextRequest) {
  const auth = await requireScope(request, 'kb:read');
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status');

    if (!process.env.DATABASE_URL) {
      // In demo mode, run analysis in-memory
      const gaps = await analyzeContentGaps(auth.user.workspaceId);
      return NextResponse.json({
        gaps: gaps.map((g, i) => ({
          id: `gap-${i}`,
          topic: g.topic,
          ticketCount: g.ticketCount,
          sampleQuestions: g.sampleQuestions,
          suggestedTitle: g.suggestedTitle,
          suggestedOutline: g.suggestedOutline,
          status: 'open',
          createdAt: new Date().toISOString(),
        })),
        total: gaps.length,
      });
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, and, desc } = await import('drizzle-orm');

    const conditions = [eq(schema.kbContentGaps.workspaceId, auth.user.workspaceId)];
    if (status) {
      conditions.push(eq(schema.kbContentGaps.status, status));
    }

    const rows = await db
      .select()
      .from(schema.kbContentGaps)
      .where(and(...conditions))
      .orderBy(desc(schema.kbContentGaps.ticketCount));

    return NextResponse.json({
      gaps: rows.map((r) => ({
        id: r.id,
        topic: r.topic,
        ticketCount: r.ticketCount,
        sampleTicketIds: r.sampleTicketIds,
        suggestedTitle: r.suggestedTitle,
        suggestedOutline: r.suggestedOutline,
        status: r.status,
        createdArticleId: r.createdArticleId,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      total: rows.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load content gaps' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/kb/content-gaps
 * Trigger fresh content gap analysis.
 * Auth required (kb:write).
 */
export async function POST(request: NextRequest) {
  const auth = await requireScope(request, 'kb:write');
  if ('error' in auth) return auth.error;

  try {
    const gaps = await analyzeContentGaps(auth.user.workspaceId);

    return NextResponse.json({
      ok: true,
      analyzed: gaps.length,
      gaps: gaps.map((g) => ({
        topic: g.topic,
        ticketCount: g.ticketCount,
        suggestedTitle: g.suggestedTitle,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to analyze content gaps' },
      { status: 500 },
    );
  }
}
