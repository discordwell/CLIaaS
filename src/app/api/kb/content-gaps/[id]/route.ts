import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

/**
 * GET /api/kb/content-gaps/:id
 * Get a single content gap. Auth required (kb:read).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'kb:view');
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 },
      );
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    const rows = await db
      .select()
      .from(schema.kbContentGaps)
      .where(
        and(
          eq(schema.kbContentGaps.id, id),
          eq(schema.kbContentGaps.workspaceId, auth.user.workspaceId),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Content gap not found' },
        { status: 404 },
      );
    }

    const r = rows[0];
    return NextResponse.json({
      gap: {
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
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load content gap' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/kb/content-gaps/:id
 * Accept or dismiss a content gap, optionally link to a created article.
 * Auth required (kb:write).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'kb:edit');
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;

    const parsed = await parseJsonBody<{
      status?: string;
      createdArticleId?: string;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { status, createdArticleId } = parsed.data;

    const validStatuses = ['open', 'accepted', 'dismissed', 'stale'];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 },
      );
    }

    if (!status && !createdArticleId) {
      return NextResponse.json(
        { error: 'No updates provided. Send status and/or createdArticleId.' },
        { status: 400 },
      );
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 },
      );
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (status) updates.status = status;
    if (createdArticleId) updates.createdArticleId = createdArticleId;

    const rows = await db
      .update(schema.kbContentGaps)
      .set(updates)
      .where(
        and(
          eq(schema.kbContentGaps.id, id),
          eq(schema.kbContentGaps.workspaceId, auth.user.workspaceId),
        ),
      )
      .returning();

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Content gap not found' },
        { status: 404 },
      );
    }

    const r = rows[0];
    return NextResponse.json({
      gap: {
        id: r.id,
        topic: r.topic,
        ticketCount: r.ticketCount,
        status: r.status,
        createdArticleId: r.createdArticleId,
        updatedAt: r.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update content gap' },
      { status: 500 },
    );
  }
}
