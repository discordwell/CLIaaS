/**
 * Webhook secret/signature verification tests for inbound webhook routes
 * hardened with timing-safe comparison: Zendesk sync webhook, Linear webhook,
 * and the Telegram channel verification helper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

vi.mock('@/lib/zendesk/sync', () => ({
  syncZendeskTicketById: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ---- Zendesk sync webhook (static shared secret) ----

describe('Zendesk webhook secret check', () => {
  const secret = 'zd-webhook-secret';

  async function callZendeskWebhook(headers: Record<string, string> = {}) {
    const { POST } = await import('@/app/api/zendesk/webhook/route');
    const { NextRequest } = await import('next/server');
    const request = new NextRequest(
      new Request('https://cliaas.com/api/zendesk/webhook', {
        method: 'POST',
        body: JSON.stringify({ ticket_id: 42 }),
        headers: { 'Content-Type': 'application/json', ...headers },
      }),
    );
    return POST(request);
  }

  beforeEach(() => {
    vi.stubEnv('ZENDESK_WEBHOOK_SECRET', secret);
  });

  it('accepts a request with the correct secret header', async () => {
    const response = await callZendeskWebhook({ 'x-zendesk-webhook-secret': secret });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe('ok');
  });

  it('accepts the secret via Bearer authorization header', async () => {
    const response = await callZendeskWebhook({ authorization: `Bearer ${secret}` });
    expect(response.status).toBe(200);
  });

  it('rejects a request with a wrong secret', async () => {
    const { syncZendeskTicketById } = await import('@/lib/zendesk/sync');
    const response = await callZendeskWebhook({ 'x-zendesk-webhook-secret': 'wrong-secret' });
    expect(response.status).toBe(401);
    expect(syncZendeskTicketById).not.toHaveBeenCalled();
  });

  it('rejects a request with a truncated secret', async () => {
    const response = await callZendeskWebhook({
      'x-zendesk-webhook-secret': secret.slice(0, -1),
    });
    expect(response.status).toBe(401);
  });

  it('rejects a request with no secret header', async () => {
    const response = await callZendeskWebhook();
    expect(response.status).toBe(401);
  });
});

// ---- Linear webhook (HMAC-SHA256 signature) ----

describe('Linear webhook signature check', () => {
  const secret = 'linear-webhook-secret';

  async function callLinearWebhook(body: string, headers: Record<string, string> = {}) {
    const { POST } = await import('@/app/api/webhooks/linear/route');
    const { NextRequest } = await import('next/server');
    const request = new NextRequest(
      new Request('https://cliaas.com/api/webhooks/linear', {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json', ...headers },
      }),
    );
    return POST(request);
  }

  beforeEach(() => {
    vi.stubEnv('LINEAR_WEBHOOK_SECRET', secret);
  });

  it('accepts a validly signed payload', async () => {
    const body = JSON.stringify({ type: 'Ping', action: 'ping' });
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    const response = await callLinearWebhook(body, { 'linear-signature': signature });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
  });

  it('rejects an invalid signature', async () => {
    const body = JSON.stringify({ type: 'Ping', action: 'ping' });
    const response = await callLinearWebhook(body, { 'linear-signature': 'deadbeef' });
    expect(response.status).toBe(401);
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const body = JSON.stringify({ type: 'Ping', action: 'ping' });
    const signature = createHmac('sha256', 'other-secret').update(body).digest('hex');
    const response = await callLinearWebhook(body, { 'linear-signature': signature });
    expect(response.status).toBe(401);
  });

  it('rejects a missing signature header', async () => {
    const body = JSON.stringify({ type: 'Ping', action: 'ping' });
    const response = await callLinearWebhook(body);
    expect(response.status).toBe(401);
  });
});

// ---- Telegram channel helper ----

describe('Telegram verifyWebhookSecret', () => {
  function requestWithHeader(value?: string): Request {
    return new Request('https://cliaas.com/api/channels/telegram/webhook', {
      method: 'POST',
      headers: value ? { 'X-Telegram-Bot-Api-Secret-Token': value } : {},
    });
  }

  it('accepts the matching secret token', async () => {
    const { verifyWebhookSecret } = await import('@/lib/channels/telegram');
    expect(verifyWebhookSecret(requestWithHeader('tg-secret'), 'tg-secret')).toBe(true);
  });

  it('rejects a wrong secret token', async () => {
    const { verifyWebhookSecret } = await import('@/lib/channels/telegram');
    expect(verifyWebhookSecret(requestWithHeader('nope'), 'tg-secret')).toBe(false);
  });

  it('rejects when the header is absent', async () => {
    const { verifyWebhookSecret } = await import('@/lib/channels/telegram');
    expect(verifyWebhookSecret(requestWithHeader(), 'tg-secret')).toBe(false);
  });
});
