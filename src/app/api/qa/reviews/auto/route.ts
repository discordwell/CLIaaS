import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { runAutoQA } from '@/lib/ai/autoqa';
import { loadTickets, loadMessages } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * POST /api/qa/reviews/auto — trigger AutoQA on a specific ticket.
 * Uses real LLM/heuristic scoring instead of random scores.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'qa:review');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    ticketId?: string;
    conversationId?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { ticketId } = parsed.data;

  if (!ticketId) {
    return NextResponse.json(
      { error: 'ticketId is required' },
      { status: 400 },
    );
  }

  const tickets = await loadTickets();
  const ticket = tickets.find(t => t.id === ticketId);
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  const messages = await loadMessages(ticketId);
  const agentReplies = messages.filter(m => m.type === 'reply' && m.author !== ticket.requester);
  const responseText = agentReplies.length > 0
    ? agentReplies[agentReplies.length - 1].body
    : messages.length > 0 ? messages[messages.length - 1].body : '';

  const result = await runAutoQA(
    ticketId,
    auth.user.workspaceId ?? 'default',
    { ticket, messages, responseText },
    { skipSampling: true },
  );

  if (result.skipped) {
    return NextResponse.json({ error: result.skipReason }, { status: 400 });
  }

  return NextResponse.json({
    review: result.review,
    flags: result.flagsCreated,
    csatPrediction: result.csatPrediction,
  }, { status: 201 });
}
