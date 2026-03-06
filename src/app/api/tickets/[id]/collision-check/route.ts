import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { loadMessages } from '@/lib/data';
import { presence } from '@/lib/realtime/presence';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tickets/{id}/collision-check?since=ISO_TIMESTAMP
 * Check for new replies since a given timestamp + active viewers.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const since = request.nextUrl.searchParams.get('since');

  if (!since) {
    return NextResponse.json({ error: 'since parameter required' }, { status: 400 });
  }

  const sinceDate = new Date(since);
  if (isNaN(sinceDate.getTime())) {
    return NextResponse.json({ error: 'Invalid since timestamp' }, { status: 400 });
  }

  try {
    const messages = await loadMessages(id);
    const newReplies = messages.filter(
      (m) => new Date(m.createdAt).getTime() > sinceDate.getTime()
    );

    const activeViewers = presence.getViewers(id).filter(
      (v) => v.userId !== auth.user.id
    );

    return NextResponse.json({
      hasNewReplies: newReplies.length > 0,
      newReplies: newReplies.map((m) => ({
        id: m.id,
        author: m.author,
        body: m.body.slice(0, 200),
        createdAt: m.createdAt,
        type: m.type,
      })),
      activeViewers,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Collision check failed' },
      { status: 500 },
    );
  }
}
