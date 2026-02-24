import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Queue Dispatch — fallback behavior', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('enqueueWebhookDelivery returns false and caller falls back', async () => {
    const { enqueueWebhookDelivery } = await import('@/lib/queue/dispatch');
    const result = await enqueueWebhookDelivery({
      webhookId: 'wh-test',
      url: 'https://example.com/hook',
      secret: 'sec',
      event: 'ticket.created',
      timestamp: new Date().toISOString(),
      data: { ticketId: 'tk-1' },
      retryPolicy: { maxAttempts: 3, delaysMs: [1000] },
    });
    expect(result).toBe(false);
  });

  it('enqueueEmailSend returns false and caller falls back', async () => {
    const { enqueueEmailSend } = await import('@/lib/queue/dispatch');
    const result = await enqueueEmailSend({
      to: 'a@b.com',
      subject: 'Test',
      text: 'hi',
    });
    expect(result).toBe(false);
  });

  it('enqueueAIResolution returns false without Redis', async () => {
    const { enqueueAIResolution } = await import('@/lib/queue/dispatch');
    const result = await enqueueAIResolution({
      ticketId: 'tk-1',
      event: 'ticket.created',
      data: { ticketId: 'tk-1' },
      requestedAt: new Date().toISOString(),
    });
    expect(result).toBe(false);
  });

  it('enqueueAutomationTick returns false without Redis', async () => {
    const { enqueueAutomationTick } = await import('@/lib/queue/dispatch');
    const result = await enqueueAutomationTick({
      tick: 1,
      scheduledAt: new Date().toISOString(),
    });
    expect(result).toBe(false);
  });
});

describe('Queue Integration — webhook dispatch inline fallback', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    vi.resetModules();
    // Mock fetch to avoid actual HTTP calls to example.com
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('dispatchWebhook still works inline when Redis is down', async () => {
    const { dispatchWebhook } = await import('@/lib/webhooks');
    // Should not throw — falls back to inline delivery
    await expect(
      dispatchWebhook({
        type: 'ticket.created',
        timestamp: new Date().toISOString(),
        data: { ticketId: 'tk-test' },
      }),
    ).resolves.toBeUndefined();
  });
});

describe('Queue Integration — email send inline fallback', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    delete process.env.SMTP_HOST;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('sendEmail returns mock success when both Redis and SMTP are unconfigured', async () => {
    const { sendEmail } = await import('@/lib/email/sender');
    const result = await sendEmail({ to: 'test@test.com', subject: 'Hi', text: 'hello' });
    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^mock-/);
  });
});

describe('Worker Registry — no Redis', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('startAllWorkers is a no-op when Redis is unavailable', async () => {
    const { startAllWorkers, getActiveWorkerCount } = await import('@/lib/queue/workers/index');
    startAllWorkers();
    expect(getActiveWorkerCount()).toBe(0);
  });

  it('stopAllWorkers is safe to call with no workers', async () => {
    const { stopAllWorkers } = await import('@/lib/queue/workers/index');
    await expect(stopAllWorkers()).resolves.toBeUndefined();
  });
});
