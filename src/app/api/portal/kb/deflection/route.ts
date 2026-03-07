import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

/**
 * POST /api/portal/kb/deflection
 * Record a deflection event (article shown to customer before ticket creation).
 * Public endpoint — no auth required.
 * Writes to kb_deflections table if DB is available, else silently succeeds.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody<{
      articleId?: string;
      query?: string;
      source?: string;
      sessionId?: string;
      deflected?: boolean;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { articleId, query, source, sessionId, deflected } = parsed.data;

    if (!query?.trim()) {
      return NextResponse.json(
        { error: 'query is required' },
        { status: 400 },
      );
    }

    // Write to DB if available
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');

        // Get first workspace for portal deflections
        const workspaces = await db
          .select({ id: schema.workspaces.id })
          .from(schema.workspaces)
          .limit(1);

        if (workspaces.length > 0) {
          await db.insert(schema.kbDeflections).values({
            workspaceId: workspaces[0].id,
            articleId: articleId || null,
            query: query.trim(),
            source: source ?? 'portal',
            sessionId: sessionId ?? null,
            deflected: deflected ?? false,
          });
        }
      } catch {
        // DB unavailable — silently succeed
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to record deflection') },
      { status: 500 },
    );
  }
}
