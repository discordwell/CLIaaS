import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { checkForNewReplies } from '@/lib/realtime/collision';
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
  const auth = await requirePerm(request, 'tickets:view');
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
    const { hasNewReplies, newReplies } = await checkForNewReplies(id, sinceDate);

    const activeViewers = presence.getViewers(id).filter(
      (v) => v.userId !== auth.user.id
    );

    return NextResponse.json({
      hasNewReplies,
      newReplies,
      activeViewers,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Collision check failed') },
      { status: 500 },
    );
  }
}
