import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getDataProvider } from '@/lib/data-provider';
import { ticketSplit } from '@/lib/events';
import { eventBus } from '@/lib/realtime/events';
import { evaluateAutomation } from '@/lib/automation/executor';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requirePerm(request, 'tickets:merge');
  if ('error' in authResult) return authResult.error;

  try {
    const { id } = await params;
    const body = await request.json();
    const { messageIds, newSubject, splitBy } = body as {
      messageIds?: string[];
      newSubject?: string;
      splitBy?: string;
    };

    if (!messageIds?.length) {
      return NextResponse.json(
        { error: 'messageIds is required and must be non-empty' },
        { status: 400 },
      );
    }

    if (!messageIds.every(mid => UUID_RE.test(mid))) {
      return NextResponse.json(
        { error: 'All message IDs must be valid UUIDs' },
        { status: 400 },
      );
    }

    const provider = await getDataProvider();
    const result = await provider.splitTicket({ ticketId: id, messageIds, newSubject, splitBy });

    ticketSplit({ sourceTicketId: id, newTicketId: result.newTicketId });
    eventBus.emit({
      type: 'ticket:split',
      data: { sourceTicketId: id, newTicketId: result.newTicketId },
      timestamp: Date.now(),
    });

    // Fire automation rules for split event
    void evaluateAutomation('ticket.split', {
      ticketId: id,
      sourceTicketId: id,
      newTicketId: result.newTicketId,
      splitBy,
    }, 'trigger').catch(() => {});

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Split failed') },
      { status: 500 },
    );
  }
}
