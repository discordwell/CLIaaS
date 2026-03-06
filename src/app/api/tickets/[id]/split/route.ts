import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getDataProvider } from '@/lib/data-provider';
import { ticketSplit } from '@/lib/events';
import { eventBus } from '@/lib/realtime/events';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    const provider = await getDataProvider();
    const result = await provider.splitTicket({ ticketId: id, messageIds, newSubject, splitBy });

    ticketSplit({ sourceTicketId: id, newTicketId: result.newTicketId });
    eventBus.emit({
      type: 'ticket:split',
      data: { sourceTicketId: id, newTicketId: result.newTicketId },
      timestamp: Date.now(),
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Split failed' },
      { status: 500 },
    );
  }
}
