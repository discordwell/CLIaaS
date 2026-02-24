import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadTickets, loadMessages } from '@/lib/data';
import {
  scoreResponse,
  recordQAReport,
  getQAOverview,
} from '@/lib/ai/qa';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ai/qa - Get QA overview stats
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const overview = getQAOverview();
  return NextResponse.json({ overview });
}

/**
 * POST /api/ai/qa - Score a response
 *
 * Body: {
 *   ticketId: string;      // required
 *   responseText: string;   // required - the reply text to evaluate
 *   messageId?: string;     // optional - ID of the message being scored
 * }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const parsed = await parseJsonBody<{
      ticketId?: string;
      responseText?: string;
      messageId?: string;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { ticketId, responseText, messageId } = parsed.data;

    if (!ticketId) {
      return NextResponse.json(
        { error: 'ticketId is required' },
        { status: 400 },
      );
    }

    if (!responseText?.trim()) {
      return NextResponse.json(
        { error: 'responseText is required' },
        { status: 400 },
      );
    }

    const tickets = await loadTickets();
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      return NextResponse.json(
        { error: `Ticket "${ticketId}" not found` },
        { status: 404 },
      );
    }

    const messages = await loadMessages(ticketId);

    const report = await scoreResponse({
      ticket,
      messages,
      responseText,
      messageId,
    });

    // Store for overview
    recordQAReport(report);

    return NextResponse.json({
      report,
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'QA scoring failed',
      },
      { status: 500 },
    );
  }
}
