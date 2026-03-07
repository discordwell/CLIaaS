/**
 * Webhook receiver for connector-driven real-time sync.
 * Supports Zendesk, Intercom, Freshdesk, HubSpot, Zoho Desk, and Help Scout webhooks.
 * Validates signatures, normalizes payloads, dispatches through event system.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { dispatch } from '@/lib/events/dispatcher';
import { createLogger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const logger = createLogger('connector-webhook');

// ---- Signature verification ----

function verifyZendeskSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('base64');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function verifyIntercomSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(`sha256=${expected}`));
  } catch {
    // Intercom may send with or without prefix
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}

function verifyFreshdeskSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('base64');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function verifyHubSpotSignature(
  request: NextRequest,
  body: string,
  secret: string,
): boolean {
  // HubSpot v3 signature: HMAC SHA-256 over requestMethod + requestUri + requestBody + timestamp
  const signature = request.headers.get('x-hubspot-signature-v3');
  const timestamp = request.headers.get('x-hubspot-request-timestamp');
  if (!signature || !timestamp) return false;

  // Replay protection: reject requests older than 5 minutes
  const age = Date.now() - parseInt(timestamp, 10);
  if (age > 300_000 || age < 0) return false;

  const url = request.url;
  const toSign = `POST${url}${body}${timestamp}`;
  const expected = createHmac('sha256', secret).update(toSign).digest('base64');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function verifyZohoDeskSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('base64');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function verifyHelpScoutSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('base64');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ---- Payload normalization ----

interface NormalizedEvent {
  event: 'ticket.created' | 'ticket.updated' | 'ticket.resolved' | 'message.created';
  data: Record<string, unknown>;
}

function normalizeZendeskPayload(payload: Record<string, unknown>): NormalizedEvent | null {
  // Zendesk triggers send a flat payload with ticket data
  const ticket = (payload.ticket ?? payload) as Record<string, unknown>;
  if (!ticket.id) return null;

  const statusMap: Record<string, string> = {
    new: 'open', open: 'open', pending: 'pending',
    hold: 'on_hold', solved: 'solved', closed: 'closed',
  };

  const event = payload.event as string | undefined;
  let canonicalEvent: NormalizedEvent['event'] = 'ticket.updated';
  if (event === 'ticket_created' || !payload.old_ticket) canonicalEvent = 'ticket.created';
  else if (ticket.status === 'solved' || ticket.status === 'closed') canonicalEvent = 'ticket.resolved';

  return {
    event: canonicalEvent,
    data: {
      ticketId: `zd-${ticket.id}`,
      externalId: String(ticket.id),
      source: 'zendesk',
      subject: ticket.subject ?? `Ticket #${ticket.id}`,
      status: statusMap[String(ticket.status ?? 'open')] ?? 'open',
      priority: ticket.priority ?? 'normal',
      assignee: ticket.assignee_id ? String(ticket.assignee_id) : undefined,
      requester: ticket.requester_id ? String(ticket.requester_id) : undefined,
      tags: Array.isArray(ticket.tags) ? ticket.tags : [],
    },
  };
}

function normalizeIntercomPayload(payload: Record<string, unknown>): NormalizedEvent | null {
  const topic = payload.topic as string | undefined;
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const item = (data.item ?? {}) as Record<string, unknown>;

  if (!item.id) return null;

  // Determine if this is a ticket or conversation
  const isTicket = item.type === 'ticket';
  const idPrefix = isTicket ? 'ic-ticket' : 'ic';

  let canonicalEvent: NormalizedEvent['event'] = 'ticket.updated';
  if (topic?.includes('created')) canonicalEvent = 'ticket.created';
  else if (topic?.includes('closed') || (item as Record<string, unknown>).state === 'closed') {
    canonicalEvent = 'ticket.resolved';
  }

  // Map conversation_part events to message.created
  if (topic === 'conversation.admin.replied' || topic === 'conversation.user.replied'
    || topic === 'conversation_part.tag.created') {
    canonicalEvent = 'message.created';
  }

  return {
    event: canonicalEvent,
    data: {
      ticketId: `${idPrefix}-${item.id}`,
      externalId: String(item.id),
      source: 'intercom',
      subject: (item.title as string) ?? `Conversation #${item.id}`,
      status: item.state === 'closed' ? 'closed' : item.state === 'snoozed' ? 'on_hold' : 'open',
      priority: item.priority === 'priority' ? 'high' : 'normal',
      assignee: (item.assignee as Record<string, unknown>)?.id
        ? String((item.assignee as Record<string, unknown>).id) : undefined,
    },
  };
}

function normalizeHubSpotPayload(payload: Record<string, unknown>): NormalizedEvent | null {
  // HubSpot sends an array of subscription events
  const events = Array.isArray(payload) ? payload : [payload];
  const first = events[0] as Record<string, unknown> | undefined;
  if (!first) return null;

  const objectId = first.objectId as number | undefined;
  if (!objectId) return null;

  const subscriptionType = first.subscriptionType as string ?? '';
  let canonicalEvent: NormalizedEvent['event'] = 'ticket.updated';
  if (subscriptionType.includes('creation')) canonicalEvent = 'ticket.created';
  else if (subscriptionType.includes('deletion')) canonicalEvent = 'ticket.resolved';

  return {
    event: canonicalEvent,
    data: {
      ticketId: `hub-${objectId}`,
      externalId: String(objectId),
      source: 'hubspot',
      subject: `Ticket #${objectId}`,
      status: canonicalEvent === 'ticket.resolved' ? 'closed' : 'open',
      propertyName: first.propertyName,
      propertyValue: first.propertyValue,
    },
  };
}

function normalizeFreshdeskPayload(payload: Record<string, unknown>): NormalizedEvent | null {
  // Freshdesk webhooks use a configurable template; we handle the standard format
  const ticket = (payload.freshdesk_webhook ?? payload) as Record<string, unknown>;
  const ticketId = ticket.ticket_id ?? ticket.id;
  if (!ticketId) return null;

  const statusMap: Record<string, string> = {
    '2': 'open', '3': 'pending', '4': 'solved', '5': 'closed',
  };

  const event = payload.event as string | undefined;
  let canonicalEvent: NormalizedEvent['event'] = 'ticket.updated';
  if (event === 'ticket_created' || payload.triggered_event === 'ticket_create') {
    canonicalEvent = 'ticket.created';
  } else if (String(ticket.ticket_status) === '4' || String(ticket.ticket_status) === '5') {
    canonicalEvent = 'ticket.resolved';
  }

  return {
    event: canonicalEvent,
    data: {
      ticketId: `fd-${ticketId}`,
      externalId: String(ticketId),
      source: 'freshdesk',
      subject: (ticket.ticket_subject ?? ticket.subject ?? `Ticket #${ticketId}`) as string,
      status: statusMap[String(ticket.ticket_status ?? '2')] ?? 'open',
      priority: ticket.ticket_priority ?? 'normal',
      assignee: ticket.ticket_agent_id ? String(ticket.ticket_agent_id) : undefined,
      requester: ticket.ticket_requester_id ? String(ticket.ticket_requester_id) : undefined,
    },
  };
}

function normalizeZohoDeskPayload(payload: Record<string, unknown>): NormalizedEvent | null {
  const module = payload.module as string | undefined;
  if (module !== 'tickets') return null;

  const event = payload.event as string | undefined;
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const ticket = (data.ticket ?? {}) as Record<string, unknown>;

  if (!ticket.id) return null;

  const statusMap: Record<string, string> = {
    'Open': 'open',
    'On Hold': 'on_hold',
    'Closed': 'closed',
    'Escalated': 'open',
  };

  let canonicalEvent: NormalizedEvent['event'] = 'ticket.updated';
  if (event === 'create') canonicalEvent = 'ticket.created';
  else if (event === 'delete' || String(ticket.status) === 'Closed') canonicalEvent = 'ticket.resolved';

  return {
    event: canonicalEvent,
    data: {
      ticketId: `zo-${ticket.id}`,
      externalId: String(ticket.id),
      source: 'zoho-desk',
      subject: (ticket.subject as string) ?? `Ticket #${ticket.id}`,
      status: statusMap[String(ticket.status ?? 'Open')] ?? 'open',
      priority: ticket.priority ?? 'normal',
      assignee: ticket.assignee ? String(ticket.assignee) : undefined,
    },
  };
}

function normalizeHelpScoutPayload(payload: Record<string, unknown>): NormalizedEvent | null {
  const eventType = payload.event as string | undefined;
  if (!eventType) return null;

  // Help Scout sends conversation-related events prefixed with "convo."
  const id = payload.id as number | undefined;
  if (!id) return null;

  const statusMap: Record<string, string> = {
    active: 'open',
    open: 'open',
    pending: 'pending',
    closed: 'closed',
    spam: 'closed',
  };

  let canonicalEvent: NormalizedEvent['event'] = 'ticket.updated';
  if (eventType === 'convo.created') canonicalEvent = 'ticket.created';
  else if (eventType === 'convo.closed' || eventType === 'convo.deleted') {
    canonicalEvent = 'ticket.resolved';
  } else if (eventType === 'convo.customer.reply.created' || eventType === 'convo.agent.reply.created') {
    canonicalEvent = 'message.created';
  }

  const status = payload.status as string | undefined;
  const subject = payload.subject as string | undefined;
  const assignee = payload.assignee as Record<string, unknown> | undefined;

  return {
    event: canonicalEvent,
    data: {
      ticketId: `hs-${id}`,
      externalId: String(id),
      source: 'helpscout',
      subject: subject ?? `Conversation #${id}`,
      status: statusMap[String(status ?? 'active')] ?? 'open',
      assignee: assignee?.id ? String(assignee.id) : undefined,
    },
  };
}

// ---- Route handler ----

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const supported = ['zendesk', 'intercom', 'freshdesk', 'hubspot', 'zoho-desk', 'helpscout'];

  if (!supported.includes(name)) {
    return NextResponse.json(
      { error: `Webhook sync not supported for '${name}'. Supported: ${supported.join(', ')}` },
      { status: 400 },
    );
  }

  const rawBody = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Signature verification
  const envKey = `${name.toUpperCase().replace(/-/g, '_')}_WEBHOOK_SECRET`;
  const secret = process.env[envKey];
  if (!secret) {
    logger.warn({ connector: name }, 'No webhook secret configured — accepting unsigned payload. Set %s for production.', envKey);
  }
  if (secret) {
    let valid = false;
    switch (name) {
      case 'zendesk':
        valid = verifyZendeskSignature(rawBody, request.headers.get('x-zendesk-webhook-signature'), secret);
        break;
      case 'intercom':
        valid = verifyIntercomSignature(rawBody, request.headers.get('x-hub-signature-256'), secret);
        break;
      case 'freshdesk':
        valid = verifyFreshdeskSignature(rawBody, request.headers.get('x-freshdesk-webhook-signature'), secret);
        break;
      case 'hubspot':
        valid = verifyHubSpotSignature(request, rawBody, secret);
        break;
      case 'zoho-desk':
        valid = verifyZohoDeskSignature(rawBody, request.headers.get('x-zoho-webhook-signature'), secret);
        break;
      case 'helpscout':
        valid = verifyHelpScoutSignature(rawBody, request.headers.get('x-helpscout-signature'), secret);
        break;
    }
    if (!valid) {
      logger.warn({ connector: name }, 'Webhook signature verification failed');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  // Normalize payload
  let normalized: NormalizedEvent | null = null;
  switch (name) {
    case 'zendesk':
      normalized = normalizeZendeskPayload(payload);
      break;
    case 'intercom':
      normalized = normalizeIntercomPayload(payload);
      break;
    case 'freshdesk':
      normalized = normalizeFreshdeskPayload(payload);
      break;
    case 'hubspot':
      normalized = normalizeHubSpotPayload(payload);
      break;
    case 'zoho-desk':
      normalized = normalizeZohoDeskPayload(payload);
      break;
    case 'helpscout':
      normalized = normalizeHelpScoutPayload(payload);
      break;
  }

  if (!normalized) {
    return NextResponse.json({ ok: true, skipped: 'unrecognized payload format' });
  }

  // Dispatch through the central event system
  dispatch(normalized.event, {
    ...normalized.data,
    webhookSource: name,
    receivedAt: new Date().toISOString(),
  });

  logger.info({
    connector: name,
    event: normalized.event,
    ticketId: normalized.data.ticketId,
  }, 'Connector webhook processed');

  return NextResponse.json({
    ok: true,
    event: normalized.event,
    ticketId: normalized.data.ticketId,
  });
}
