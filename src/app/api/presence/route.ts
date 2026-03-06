import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { presence } from '@/lib/realtime/presence';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * POST: Update presence (viewing/typing)
 * GET:  Get viewers for a ticket
 */
export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const userId = auth.user.id;
  const userName = auth.user.name || auth.user.email || 'Agent';

  try {
    const { ticketId, activity, action } = await request.json();

    if (!ticketId) {
      return NextResponse.json({ error: 'ticketId required' }, { status: 400 });
    }

    if (action === 'leave') {
      presence.leave(userId, ticketId);
    } else {
      const validActivity = activity === 'typing' ? 'typing' : 'viewing';
      presence.update(userId, userName, ticketId, validActivity);
    }

    const viewers = presence.getViewers(ticketId);
    return NextResponse.json({ ok: true, currentUserId: userId, viewers });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Presence update failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const ticketId = request.nextUrl.searchParams.get('ticketId');
  if (!ticketId) {
    return NextResponse.json({ error: 'ticketId required' }, { status: 400 });
  }

  const viewers = presence.getViewers(ticketId);
  return NextResponse.json({ currentUserId: auth.user.id, viewers });
}
