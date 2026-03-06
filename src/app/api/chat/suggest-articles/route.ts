import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { suggestArticles } from '@/lib/kb/text-match';

export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/suggest-articles
 * Returns relevant KB articles for a chat message.
 * Uses the same text-matching as portal suggest.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody<{
      message?: string;
      brandId?: string;
      locale?: string;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { message, brandId, locale } = parsed.data;

    if (!message?.trim()) {
      return NextResponse.json({ articles: [] });
    }

    const articles = await suggestArticles({
      query: message.trim(),
      brandId: brandId ?? undefined,
      locale: locale ?? undefined,
      limit: 3,
    });

    return NextResponse.json({ articles });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to suggest articles' },
      { status: 500 },
    );
  }
}
