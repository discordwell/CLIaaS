import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveTicket } from '@/lib/ai/resolution-pipeline';
import { loadTickets, loadMessages, loadKBArticles } from '@/lib/data';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const parsed = await parseJsonBody<{ ticketId?: string }>(request);
    if ('error' in parsed) return parsed.error;
    const { ticketId } = parsed.data;

    if (!ticketId) {
      return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
    }

    const tickets = await loadTickets();
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const allMessages = await loadMessages();
    const messages = allMessages.filter(m => m.ticketId === ticketId);
    const kbArticles = await loadKBArticles();

    const outcome = await resolveTicket(ticket, messages, kbArticles);
    return NextResponse.json(outcome);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Resolution failed' },
      { status: 500 },
    );
  }
}
