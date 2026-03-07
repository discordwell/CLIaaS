/**
 * HubSpot webhook signature verification and payload normalization tests.
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

describe('HubSpot webhook endpoint', () => {
  const secret = 'hubspot-test-secret-key';

  beforeEach(() => {
    vi.stubEnv('HUBSPOT_WEBHOOK_SECRET', secret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeHubSpotPayload(objectId: number, subscriptionType: string) {
    return [{
      objectId,
      subscriptionType,
      portalId: 12345,
      occurredAt: Date.now(),
      propertyName: 'hs_pipeline_stage',
      propertyValue: '1',
    }];
  }

  function signRequest(url: string, body: string, timestamp: string) {
    const toSign = `POST${url}${body}${timestamp}`;
    return createHmac('sha256', secret).update(toSign).digest('base64');
  }

  async function callWebhook(
    body: string,
    headers: Record<string, string> = {},
    url = 'https://cliaas.com/api/connectors/hubspot/webhook',
  ) {
    const { POST } = await import('@/app/api/connectors/[name]/webhook/route');
    const request = new Request(url, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
    // NextRequest requires url in constructor
    const { NextRequest } = await import('next/server');
    const nextReq = new NextRequest(request);
    return POST(nextReq, { params: Promise.resolve({ name: 'hubspot' }) });
  }

  it('accepts validly signed HubSpot webhook', async () => {
    const payload = makeHubSpotPayload(999, 'ticket.propertyChange');
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const url = 'https://cliaas.com/api/connectors/hubspot/webhook';
    const signature = signRequest(url, body, timestamp);

    const response = await callWebhook(body, {
      'x-hubspot-signature-v3': signature,
      'x-hubspot-request-timestamp': timestamp,
    }, url);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.event).toBe('ticket.updated');
    expect(json.ticketId).toBe('hub-999');
  });

  it('rejects invalid signature', async () => {
    const payload = makeHubSpotPayload(999, 'ticket.propertyChange');
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());

    const response = await callWebhook(body, {
      'x-hubspot-signature-v3': 'invalid-signature-value',
      'x-hubspot-request-timestamp': timestamp,
    });

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe('Invalid signature');
  });

  it('rejects replayed requests older than 5 minutes', async () => {
    const payload = makeHubSpotPayload(999, 'ticket.propertyChange');
    const body = JSON.stringify(payload);
    // Timestamp from 10 minutes ago
    const oldTimestamp = String(Date.now() - 600_000);
    const url = 'https://cliaas.com/api/connectors/hubspot/webhook';
    const signature = signRequest(url, body, oldTimestamp);

    const response = await callWebhook(body, {
      'x-hubspot-signature-v3': signature,
      'x-hubspot-request-timestamp': oldTimestamp,
    }, url);

    expect(response.status).toBe(401);
  });

  it('normalizes ticket.creation subscription type', async () => {
    const payload = makeHubSpotPayload(123, 'ticket.creation');
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const url = 'https://cliaas.com/api/connectors/hubspot/webhook';
    const signature = signRequest(url, body, timestamp);

    const response = await callWebhook(body, {
      'x-hubspot-signature-v3': signature,
      'x-hubspot-request-timestamp': timestamp,
    }, url);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.event).toBe('ticket.created');
    expect(json.ticketId).toBe('hub-123');
  });
});
