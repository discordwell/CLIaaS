/**
 * Zendesk webhook auth: fail closed in production, fail open in dev/test so local
 * setup stays exercisable. Regression test for the unauthenticated-when-secret-unset bug.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/zendesk/sync', () => ({
  syncZendeskTicketById: vi.fn().mockResolvedValue(undefined),
}));

async function callZendesk(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const { POST } = await import('@/app/api/zendesk/webhook/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest(
    new Request('https://cliaas.com/api/zendesk/webhook', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  );
  return POST(req);
}

describe('zendesk webhook auth', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('fails closed (401) in production when no secret is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ZENDESK_WEBHOOK_SECRET', '');
    const res = await callZendesk({ ticket_id: 1 });
    expect(res.status).toBe(401);
  });

  it('does not 401 outside production when no secret is configured', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ZENDESK_WEBHOOK_SECRET', '');
    const res = await callZendesk({ ticket_id: 1 });
    expect(res.status).not.toBe(401);
  });

  it('accepts the correct secret and rejects a wrong one when configured', async () => {
    vi.stubEnv('ZENDESK_WEBHOOK_SECRET', 's3cr3t');
    const ok = await callZendesk({ ticket_id: 1 }, { 'x-zendesk-webhook-secret': 's3cr3t' });
    expect(ok.status).not.toBe(401);
    const bad = await callZendesk({ ticket_id: 1 }, { 'x-zendesk-webhook-secret': 'nope' });
    expect(bad.status).toBe(401);
  });
});
