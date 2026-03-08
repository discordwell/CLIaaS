/**
 * Ticket-scoped presence API for collision detection.
 *
 * POST   /api/tickets/[id]/presence  — register/heartbeat presence
 * GET    /api/tickets/[id]/presence  — get current viewers
 * DELETE /api/tickets/[id]/presence  — unregister presence
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { presenceStore } from '@/lib/presence/store';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * POST: Register or update presence on a ticket.
 * Body: { status?: 'viewing' | 'replying' }
 * Defaults to 'viewing' if status is omitted or invalid.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const { id: ticketId } = await params;
  const userId = auth.user.id;
  const userName = auth.user.name || auth.user.email || 'Agent';

  let status: 'viewing' | 'replying' = 'viewing';
  try {
    const body = await request.json();
    if (body.status === 'replying') {
      status = 'replying';
    }
  } catch {
    // No body or malformed — default to 'viewing'
  }

  presenceStore.setPresence(ticketId, userId, userName, status);

  // Also update the legacy realtime presence tracker so SSE events fire
  try {
    const { presence } = await import('@/lib/realtime/presence');
    const legacyActivity = status === 'replying' ? 'typing' : 'viewing';
    presence.update(userId, userName, ticketId, legacyActivity);
  } catch {
    // Realtime module not available — no-op
  }

  const entries = presenceStore.getPresence(ticketId);
  return NextResponse.json({
    ok: true,
    currentUserId: userId,
    viewers: entries,
  });
}

/**
 * GET: Get all users currently viewing/replying to a ticket.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const { id: ticketId } = await params;
  const entries = presenceStore.getPresence(ticketId);

  return NextResponse.json({
    currentUserId: auth.user.id,
    viewers: entries,
  });
}

/**
 * DELETE: Unregister presence when user navigates away.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const { id: ticketId } = await params;
  const userId = auth.user.id;

  presenceStore.removePresence(ticketId, userId);

  // Also clear from legacy realtime presence tracker
  try {
    const { presence } = await import('@/lib/realtime/presence');
    presence.leave(userId, ticketId);
  } catch {
    // Realtime module not available — no-op
  }

  return NextResponse.json({ ok: true });
}
