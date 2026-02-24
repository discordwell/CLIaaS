import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { type ConnectorName, getAuth } from '@/lib/connector-auth';
import { zendeskCreateTicket } from '@cli/connectors/zendesk';
import { helpcrunchCreateChat } from '@cli/connectors/helpcrunch';
import { freshdeskCreateTicket } from '@cli/connectors/freshdesk';
import { grooveCreateTicket } from '@cli/connectors/groove';
import { ticketCreated } from '@/lib/events';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireScope } from '@/lib/api-auth';

export async function POST(request: NextRequest) {
  const authResult = await requireScope(request, 'tickets:write');
  if ('error' in authResult) return authResult.error;

  const parsed = await parseJsonBody<{
    source: ConnectorName;
    subject?: string;
    message: string;
    priority?: string;
    to?: string; // email for Groove, customer ID for HelpCrunch
  }>(request);
  if ('error' in parsed) return parsed.error;
  const { source, subject, message, priority, to } = parsed.data;

  const VALID_SOURCES = ['zendesk', 'helpcrunch', 'freshdesk', 'groove'];

  if (!source || !message?.trim()) {
    return NextResponse.json({ error: 'source and message are required' }, { status: 400 });
  }
  if (!VALID_SOURCES.includes(source)) {
    return NextResponse.json({ error: `Invalid source: ${source}` }, { status: 400 });
  }

  const auth = getAuth(source);
  if (!auth) {
    return NextResponse.json({ error: `${source} not configured` }, { status: 400 });
  }

  try {
    let result: Record<string, unknown> = {};

    switch (source) {
      case 'zendesk':
        result = await zendeskCreateTicket(
          auth as Parameters<typeof zendeskCreateTicket>[0],
          subject ?? 'New ticket',
          message,
          priority ? { priority } : undefined,
        );
        break;
      case 'helpcrunch': {
        const customerId = to ? parseInt(to, 10) : 0;
        if (!customerId) {
          return NextResponse.json({ error: 'HelpCrunch requires a customer ID (to)' }, { status: 400 });
        }
        result = await helpcrunchCreateChat(
          auth as Parameters<typeof helpcrunchCreateChat>[0],
          customerId,
          message,
        );
        break;
      }
      case 'freshdesk':
        result = await freshdeskCreateTicket(
          auth as Parameters<typeof freshdeskCreateTicket>[0],
          subject ?? 'New ticket',
          message,
          priority ? { priority: parseInt(priority, 10) } : undefined,
        );
        break;
      case 'groove':
        if (!to) {
          return NextResponse.json({ error: 'Groove requires a recipient email (to)' }, { status: 400 });
        }
        result = await grooveCreateTicket(
          auth as Parameters<typeof grooveCreateTicket>[0],
          to,
          message,
          subject ? { subject } : undefined,
        );
        break;
    }

    ticketCreated({ source, subject, ...result });
    return NextResponse.json({ status: 'ok', ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Create failed' },
      { status: 500 },
    );
  }
}
