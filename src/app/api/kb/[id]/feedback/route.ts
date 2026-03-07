import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'kb:view');
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ feedback: [], summary: { helpful: 0, notHelpful: 0, total: 0 } });
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, and, desc } = await import('drizzle-orm');

    const [article] = await db
      .select({ id: schema.kbArticles.id, helpfulCount: schema.kbArticles.helpfulCount, notHelpfulCount: schema.kbArticles.notHelpfulCount })
      .from(schema.kbArticles)
      .where(and(eq(schema.kbArticles.id, id), eq(schema.kbArticles.workspaceId, auth.user.workspaceId)))
      .limit(1);

    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    const feedback = await db
      .select()
      .from(schema.kbArticleFeedback)
      .where(and(eq(schema.kbArticleFeedback.articleId, id), eq(schema.kbArticleFeedback.workspaceId, auth.user.workspaceId)))
      .orderBy(desc(schema.kbArticleFeedback.createdAt))
      .limit(100);

    return NextResponse.json({
      feedback: feedback.map((f: typeof feedback[number]) => ({
        id: f.id,
        helpful: f.helpful,
        comment: f.comment,
        createdAt: f.createdAt?.toISOString(),
      })),
      summary: {
        helpful: article.helpfulCount ?? 0,
        notHelpful: article.notHelpfulCount ?? 0,
        total: (article.helpfulCount ?? 0) + (article.notHelpfulCount ?? 0),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load feedback') },
      { status: 500 }
    );
  }
}
