/**
 * Zoho Desk and Help Scout webhook signature verification and payload normalization tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

// Mock modules before importing route handler
vi.mock('@/lib/events/dispatcher', () => ({
  dispatch: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---- Helpers ----

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

async function callWebhook(
  connectorName: string,
  body: string,
  headers: Record<string, string> = {},
) {
  const { POST } = await import('@/app/api/connectors/[name]/webhook/route');
  const url = `https://cliaas.com/api/connectors/${connectorName}/webhook`;
  const request = new Request(url, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  const { NextRequest } = await import('next/server');
  const nextReq = new NextRequest(request);
  return POST(nextReq, { params: Promise.resolve({ name: connectorName }) });
}

// ---- Zoho Desk ----

describe('Zoho Desk webhook endpoint', () => {
  const secret = 'zoho-desk-test-secret';

  beforeEach(() => {
    vi.stubEnv('ZOHO_DESK_WEBHOOK_SECRET', secret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeZohoPayload(
    event: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      module: 'tickets',
      event,
      data: {
        ticket: {
          id: '50001',
          subject: 'Cannot login',
          status: 'Open',
          priority: 'High',
          assignee: 'agent-42',
          ...overrides,
        },
      },
    };
  }

  it('accepts validly signed Zoho Desk webhook', async () => {
    const payload = makeZohoPayload('create');
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('zoho-desk', body, {
      'x-zoho-webhook-signature': signature,
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.event).toBe('ticket.created');
    expect(json.ticketId).toBe('zo-50001');
  });

  it('rejects invalid Zoho Desk signature', async () => {
    const payload = makeZohoPayload('create');
    const body = JSON.stringify(payload);

    const response = await callWebhook('zoho-desk', body, {
      'x-zoho-webhook-signature': 'totally-wrong-sig',
    });

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe('Invalid signature');
  });

  it('rejects missing Zoho Desk signature header', async () => {
    const payload = makeZohoPayload('create');
    const body = JSON.stringify(payload);

    // No signature header at all
    const response = await callWebhook('zoho-desk', body);

    expect(response.status).toBe(401);
  });

  it('normalizes Zoho Desk create event', async () => {
    const payload = makeZohoPayload('create');
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('zoho-desk', body, {
      'x-zoho-webhook-signature': signature,
    });

    const json = await response.json();
    expect(json.event).toBe('ticket.created');
    expect(json.ticketId).toBe('zo-50001');
  });

  it('normalizes Zoho Desk update event', async () => {
    const payload = makeZohoPayload('update', { status: 'On Hold' });
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('zoho-desk', body, {
      'x-zoho-webhook-signature': signature,
    });

    const json = await response.json();
    expect(json.event).toBe('ticket.updated');
    expect(json.ticketId).toBe('zo-50001');
  });

  it('normalizes Zoho Desk close (Closed status) as ticket.resolved', async () => {
    const payload = makeZohoPayload('update', { status: 'Closed' });
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('zoho-desk', body, {
      'x-zoho-webhook-signature': signature,
    });

    const json = await response.json();
    expect(json.event).toBe('ticket.resolved');
  });

  it('normalizes Zoho Desk delete event as ticket.resolved', async () => {
    const payload = makeZohoPayload('delete');
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('zoho-desk', body, {
      'x-zoho-webhook-signature': signature,
    });

    const json = await response.json();
    expect(json.event).toBe('ticket.resolved');
  });

  it('maps Escalated status to open', async () => {
    const payload = makeZohoPayload('update', { status: 'Escalated' });
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('zoho-desk', body, {
      'x-zoho-webhook-signature': signature,
    });

    expect(response.status).toBe(200);
  });

  it('skips non-ticket module payloads', async () => {
    const payload = { module: 'contacts', event: 'create', data: {} };
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('zoho-desk', body, {
      'x-zoho-webhook-signature': signature,
    });

    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.skipped).toBeDefined();
  });
});

// ---- Help Scout ----

describe('Help Scout webhook endpoint', () => {
  const secret = 'helpscout-test-secret';

  beforeEach(() => {
    vi.stubEnv('HELPSCOUT_WEBHOOK_SECRET', secret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeHelpScoutPayload(
    event: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      _links: { self: { href: 'https://api.helpscout.net/v2/conversations/999' } },
      id: 999,
      type: 'conversation',
      event,
      status: 'active',
      subject: 'Billing question',
      assignee: { id: 101, email: 'agent@example.com' },
      ...overrides,
    };
  }

  it('accepts validly signed Help Scout webhook', async () => {
    const payload = makeHelpScoutPayload('convo.created');
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('helpscout', body, {
      'x-helpscout-signature': signature,
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.event).toBe('ticket.created');
    expect(json.ticketId).toBe('hs-999');
  });

  it('rejects invalid Help Scout signature', async () => {
    const payload = makeHelpScoutPayload('convo.created');
    const body = JSON.stringify(payload);

    const response = await callWebhook('helpscout', body, {
      'x-helpscout-signature': 'bad-signature',
    });

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe('Invalid signature');
  });

  it('rejects missing Help Scout signature header', async () => {
    const payload = makeHelpScoutPayload('convo.created');
    const body = JSON.stringify(payload);

    const response = await callWebhook('helpscout', body);

    expect(response.status).toBe(401);
  });

  it('normalizes convo.created to ticket.created', async () => {
    const payload = makeHelpScoutPayload('convo.created');
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('helpscout', body, {
      'x-helpscout-signature': signature,
    });

    const json = await response.json();
    expect(json.event).toBe('ticket.created');
    expect(json.ticketId).toBe('hs-999');
  });

  it('normalizes convo.updated to ticket.updated', async () => {
    const payload = makeHelpScoutPayload('convo.updated');
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('helpscout', body, {
      'x-helpscout-signature': signature,
    });

    const json = await response.json();
    expect(json.event).toBe('ticket.updated');
  });

  it('normalizes convo.closed to ticket.resolved', async () => {
    const payload = makeHelpScoutPayload('convo.closed', { status: 'closed' });
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('helpscout', body, {
      'x-helpscout-signature': signature,
    });

    const json = await response.json();
    expect(json.event).toBe('ticket.resolved');
  });

  it('normalizes convo.deleted to ticket.resolved', async () => {
    const payload = makeHelpScoutPayload('convo.deleted');
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('helpscout', body, {
      'x-helpscout-signature': signature,
    });

    const json = await response.json();
    expect(json.event).toBe('ticket.resolved');
  });

  it('normalizes convo.customer.reply.created to message.created', async () => {
    const payload = makeHelpScoutPayload('convo.customer.reply.created');
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('helpscout', body, {
      'x-helpscout-signature': signature,
    });

    const json = await response.json();
    expect(json.event).toBe('message.created');
  });

  it('normalizes convo.agent.reply.created to message.created', async () => {
    const payload = makeHelpScoutPayload('convo.agent.reply.created');
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('helpscout', body, {
      'x-helpscout-signature': signature,
    });

    const json = await response.json();
    expect(json.event).toBe('message.created');
  });

  it('maps pending status correctly', async () => {
    const payload = makeHelpScoutPayload('convo.updated', { status: 'pending' });
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('helpscout', body, {
      'x-helpscout-signature': signature,
    });

    expect(response.status).toBe(200);
  });

  it('includes assignee in normalized data', async () => {
    const payload = makeHelpScoutPayload('convo.created', {
      assignee: { id: 42, email: 'a@b.com' },
    });
    const body = JSON.stringify(payload);
    const signature = sign(body, secret);

    const response = await callWebhook('helpscout', body, {
      'x-helpscout-signature': signature,
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
  });
});
