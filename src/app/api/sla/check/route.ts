import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkTicketSLA } from '@/lib/sla';
import { loadTickets, loadMessages, type Ticket } from '@/lib/data';
import { slaBreached } from '@/lib/events';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const parsed = await parseJsonBody<{
      ticketId?: string;
      ticket?: Ticket;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { ticketId, ticket: rawTicket } = parsed.data;

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

    // Emit sla.breached event if any result has a breach
    for (const r of results) {
      if (r.firstResponse.status === 'breached' || r.resolution.status === 'breached') {
        slaBreached({
          ticketId: ticket.id,
          policyId: r.policyId,
          policyName: r.policyName,
          firstResponseBreached: r.firstResponse.status === 'breached',
          resolutionBreached: r.resolution.status === 'breached',
        });
        break; // one event per check
      }
    }

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
