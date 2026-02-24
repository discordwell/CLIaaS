import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { presence } from '@/lib/realtime/presence';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST: Update presence (viewing/typing)
 * GET:  Get viewers for a ticket
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { userId, userName, ticketId, activity, action } = await request.json();

    if (!ticketId) {
      return NextResponse.json({ error: 'ticketId required' }, { status: 400 });
    }

    if (action === 'leave') {
      presence.leave(userId, ticketId);
    } else {
      presence.update(
        userId || 'anonymous',
        userName || 'Anonymous',
        ticketId,
        activity || 'viewing'
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Presence update failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const ticketId = request.nextUrl.searchParams.get('ticketId');
  if (!ticketId) {
    return NextResponse.json({ error: 'ticketId required' }, { status: 400 });
  }

  const viewers = presence.getViewers(ticketId);
  return NextResponse.json({ viewers });
}
