/**
 * Batch presence API for the ticket list.
 *
 * POST /api/presence/batch — get presence for multiple tickets at once.
 * Body: { ticketIds: string[] }
 * Returns: { presence: Record<ticketId, PresenceEntry[]> }
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { presenceStore } from '@/lib/presence/store';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  try {
    const { ticketIds } = await request.json();

    if (!Array.isArray(ticketIds)) {
      return NextResponse.json(
        { error: 'ticketIds must be an array' },
        { status: 400 },
      );
    }

    // Cap at 200 to prevent abuse
    const ids = ticketIds.slice(0, 200) as string[];
    const presence = presenceStore.getPresenceBatch(ids);

    return NextResponse.json({
      currentUserId: auth.user.id,
      presence,
    });
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 },
    );
  }
}
