import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { suggestArticles } from '@/lib/kb/text-match';

export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/suggest-articles
 * Returns relevant KB articles for a chat message.
 * Auth required (kb:read) — this is an agent-facing endpoint, not portal.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

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
      { error: safeErrorMessage(err, 'Failed to suggest articles') },
      { status: 500 },
    );
  }
}
