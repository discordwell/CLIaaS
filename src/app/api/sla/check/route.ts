import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkTicketSLA } from '@/lib/sla';
import { loadTickets, loadMessages, type Ticket } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const { ticketId, ticket: rawTicket } = body as {
      ticketId?: string;
      ticket?: Ticket;
    };

    let ticket: Ticket | undefined;

    if (rawTicket && rawTicket.id) {
      // Ticket data provided inline
      ticket = rawTicket;
    } else if (ticketId) {
      // Look up ticket by ID
      const tickets = await loadTickets();
      ticket = tickets.find((t) => t.id === ticketId || t.externalId === ticketId);
    }

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found. Provide ticketId or ticket object.' },
        { status: 404 }
      );
    }

    // Find first agent reply for this ticket
    const messages = await loadMessages(ticket.id);
    const sortedMsgs = [...messages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const firstReply = sortedMsgs.find(
      (m) => m.type === 'reply' && m.author !== ticket!.requester
    );

    const results = await checkTicketSLA({
      ticket,
      firstReplyAt: firstReply?.createdAt ?? null,
      resolvedAt: (ticket.status === 'solved' || ticket.status === 'closed')
        ? ticket.updatedAt
        : null,
    });

    return NextResponse.json({
      ticketId: ticket.id,
      externalId: ticket.externalId,
      status: ticket.status,
      priority: ticket.priority,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to check SLA' },
      { status: 500 }
    );
  }
}
