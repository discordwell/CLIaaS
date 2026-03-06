import { NextRequest, NextResponse } from 'next/server';
import { routeTicket } from '@/lib/routing/engine';
import { getDataProvider } from '@/lib/data-provider/index';
import { availability } from '@/lib/routing/availability';
import { eventBus } from '@/lib/realtime/events';
import { requireScope } from '@/lib/api-auth';

export async function POST(request: NextRequest) {
  const auth = await requireScope(request, 'routing:write');
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const ticketId = body.ticketId;

  if (!ticketId) {
    return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
  }

  const provider = await getDataProvider();
  const tickets = await provider.loadTickets();
  const ticket = tickets.find(t => t.id === ticketId || t.externalId === ticketId);

  if (!ticket) {
    return NextResponse.json({ error: `Ticket "${ticketId}" not found` }, { status: 404 });
  }

  const messages = await provider.loadMessages(ticket.id);

  // Build agent list from availability tracker
  const allAvail = availability.getAllAvailability();
  const allAgents = allAvail.map(a => ({ userId: a.userId, userName: a.userName }));

  // If no agents in availability tracker, fall back to empty (will return unassigned)
  const result = await routeTicket(ticket, {
    allAgents,
    messages,
    channelType: ticket.source,
  });

  // Apply assignment if an agent was selected
  if (result.suggestedAgentId) {
    try {
      await provider.updateTicket(ticket.id, { assignee: result.suggestedAgentName });
    } catch {
      // JSONL provider doesn't support writes — that's OK
    }

    eventBus.emit({
      type: 'ticket:routed',
      data: {
        ticketId: ticket.id,
        agentId: result.suggestedAgentId,
        agentName: result.suggestedAgentName,
        strategy: result.strategy,
        queueId: result.queueId,
        ruleId: result.ruleId,
      },
      timestamp: Date.now(),
    });
  }

  return NextResponse.json(result);
}
