import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * GET /api/kb/feedback/analytics
 * Aggregate feedback analytics across all articles in the workspace.
 * Auth required (kb:read).
 */
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'analytics:view');
  if ('error' in auth) return auth.error;

  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({
        totalFeedback: 0,
        totalHelpful: 0,
        totalNotHelpful: 0,
        topHelpful: [],
        topUnhelpful: [],
      });
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    // Get articles with feedback counts, scoped by workspace
    const articles = await db
      .select({
        id: schema.kbArticles.id,
        title: schema.kbArticles.title,
        helpfulCount: schema.kbArticles.helpfulCount,
        notHelpfulCount: schema.kbArticles.notHelpfulCount,
        viewCount: schema.kbArticles.viewCount,
      })
      .from(schema.kbArticles)
      .where(eq(schema.kbArticles.workspaceId, auth.user.workspaceId));

    let totalHelpful = 0;
    let totalNotHelpful = 0;

    for (const a of articles) {
      totalHelpful += a.helpfulCount ?? 0;
      totalNotHelpful += a.notHelpfulCount ?? 0;
    }

    // Top helpful: sorted by helpful count desc
    const topHelpful = [...articles]
      .sort((a, b) => (b.helpfulCount ?? 0) - (a.helpfulCount ?? 0))
      .slice(0, 10)
      .filter((a) => (a.helpfulCount ?? 0) > 0)
      .map((a) => ({
        id: a.id,
        title: a.title,
        helpfulCount: a.helpfulCount ?? 0,
        notHelpfulCount: a.notHelpfulCount ?? 0,
        viewCount: a.viewCount ?? 0,
      }));

    // Top unhelpful: sorted by not-helpful count desc
    const topUnhelpful = [...articles]
      .sort((a, b) => (b.notHelpfulCount ?? 0) - (a.notHelpfulCount ?? 0))
      .slice(0, 10)
      .filter((a) => (a.notHelpfulCount ?? 0) > 0)
      .map((a) => ({
        id: a.id,
        title: a.title,
        helpfulCount: a.helpfulCount ?? 0,
        notHelpfulCount: a.notHelpfulCount ?? 0,
        viewCount: a.viewCount ?? 0,
      }));

    // Get deflection stats
    let totalDeflections = 0;
    let successfulDeflections = 0;
    try {
      const deflectionRows = await db
        .select({
          deflected: schema.kbDeflections.deflected,
        })
        .from(schema.kbDeflections)
        .where(eq(schema.kbDeflections.workspaceId, auth.user.workspaceId));

      totalDeflections = deflectionRows.length;
      successfulDeflections = deflectionRows.filter((r) => r.deflected).length;
    } catch {
      // Table may not exist yet
    }

    return NextResponse.json({
      totalFeedback: totalHelpful + totalNotHelpful,
      totalHelpful,
      totalNotHelpful,
      topHelpful,
      topUnhelpful,
      deflections: {
        total: totalDeflections,
        successful: successfulDeflections,
        rate: totalDeflections > 0
          ? Math.round((successfulDeflections / totalDeflections) * 100)
          : 0,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load analytics') },
      { status: 500 },
    );
  }
}
