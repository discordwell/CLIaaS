import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

/**
 * POST /api/portal/kb/:id/feedback
 * Submit helpful/not-helpful feedback for an article.
 * Public endpoint — no auth required.
 * Updates article counters in DB.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: articleId } = await params;

    const parsed = await parseJsonBody<{
      helpful?: boolean;
      comment?: string;
      sessionId?: string;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { helpful, comment, sessionId } = parsed.data;

    if (typeof helpful !== 'boolean') {
      return NextResponse.json(
        { error: 'helpful (boolean) is required' },
        { status: 400 },
      );
    }

    // Write to DB if available
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq, sql } = await import('drizzle-orm');

        // Get workspace from the article
        const articleRows = await db
          .select({ workspaceId: schema.kbArticles.workspaceId })
          .from(schema.kbArticles)
          .where(eq(schema.kbArticles.id, articleId))
          .limit(1);

        if (articleRows.length === 0) {
          return NextResponse.json(
            { error: 'Article not found' },
            { status: 404 },
          );
        }

        const workspaceId = articleRows[0].workspaceId;

        // Insert feedback + update counter atomically
        await db.transaction(async (tx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          await tx.insert(schema.kbArticleFeedback).values({
            workspaceId,
            articleId,
            helpful,
            comment: comment ?? null,
            sessionId: sessionId ?? null,
          });

          const counterCol = helpful ? 'helpfulCount' : 'notHelpfulCount';
          const counterField = helpful ? schema.kbArticles.helpfulCount : schema.kbArticles.notHelpfulCount;
          await tx
            .update(schema.kbArticles)
            .set({ [counterCol]: sql`COALESCE(${counterField}, 0) + 1` })
            .where(eq(schema.kbArticles.id, articleId));
        });
      } catch {
        // DB unavailable — silently succeed
      }
    }

    return NextResponse.json({ ok: true, helpful });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to submit feedback') },
      { status: 500 },
    );
  }
}
