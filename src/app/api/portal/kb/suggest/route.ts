import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { suggestArticles } from '@/lib/kb/text-match';

export const dynamic = 'force-dynamic';

/**
 * POST /api/portal/kb/suggest
 * Public endpoint — no auth required.
 * Returns top 5 KB articles matching the query.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody<{
      query?: string;
      brandId?: string;
      locale?: string;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { query, brandId, locale } = parsed.data;

    if (!query?.trim()) {
      return NextResponse.json({ articles: [] });
    }

    const articles = await suggestArticles({
      query: query.trim(),
      brandId: brandId ?? undefined,
      locale: locale ?? undefined,
      limit: 5,
    });

    return NextResponse.json({ articles });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to suggest articles') },
      { status: 500 },
    );
  }
}
