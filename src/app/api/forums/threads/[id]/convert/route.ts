import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { convertToTicket, getThread } from '@/lib/forums/forum-store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/forums/threads/:id/convert — convert a thread to a support ticket
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'forums:moderate');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const thread = getThread(id);
  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  if (thread.convertedTicketId) {
    return NextResponse.json(
      { error: 'Thread has already been converted to a ticket', ticketId: thread.convertedTicketId },
      { status: 409 },
    );
  }

  const parsed = await parseJsonBody<{ ticketId?: string }>(request);
  if ('error' in parsed) return parsed.error;

  const { ticketId } = parsed.data;
  if (!ticketId?.trim()) {
    return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
  }

  const updated = convertToTicket(id, ticketId.trim());
  if (!updated) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  return NextResponse.json({ thread: updated });
}
