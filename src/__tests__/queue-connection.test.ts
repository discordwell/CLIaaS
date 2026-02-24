import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Queue Connection', () => {
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

  it('getRedis() returns null when REDIS_URL is not set', async () => {
    const { getRedis } = await import('@/lib/queue/connection');
    expect(getRedis()).toBeNull();
  });

  it('isRedisAvailable() returns false when REDIS_URL is not set', async () => {
    const { isRedisAvailable } = await import('@/lib/queue/connection');
    expect(isRedisAvailable()).toBe(false);
  });

  it('getRedisConnectionOpts() returns null when REDIS_URL is not set', async () => {
    const { getRedisConnectionOpts } = await import('@/lib/queue/connection');
    expect(getRedisConnectionOpts()).toBeNull();
  });

  it('getQueue() returns null when Redis is unavailable', async () => {
    const { getQueue } = await import('@/lib/queue/queues');
    expect(getQueue('webhook-delivery')).toBeNull();
  });
});

describe('Queue Dispatch Fallback', () => {
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

  it('enqueueWebhookDelivery returns false without Redis', async () => {
    const { enqueueWebhookDelivery } = await import('@/lib/queue/dispatch');
    const result = await enqueueWebhookDelivery({
      webhookId: 'wh-1',
      url: 'https://example.com/hook',
      secret: 'secret',
      event: 'ticket.created',
      timestamp: new Date().toISOString(),
      data: { ticketId: '1' },
      retryPolicy: { maxAttempts: 3, delaysMs: [1000, 5000, 30000] },
    });
    expect(result).toBe(false);
  });

  it('enqueueEmailSend returns false without Redis', async () => {
    const { enqueueEmailSend } = await import('@/lib/queue/dispatch');
    const result = await enqueueEmailSend({
      to: 'user@example.com',
      subject: 'Test',
      text: 'Hello',
    });
    expect(result).toBe(false);
  });

  it('enqueueAIResolution returns false without Redis', async () => {
    const { enqueueAIResolution } = await import('@/lib/queue/dispatch');
    const result = await enqueueAIResolution({
      ticketId: 'tk-1',
      event: 'ticket.created',
      data: {},
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

describe('Queue Stats Fallback', () => {
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

  it('getQueueStats returns null without Redis', async () => {
    const { getQueueStats } = await import('@/lib/queue/stats');
    const result = await getQueueStats('webhook-delivery');
    expect(result).toBeNull();
  });

  it('getAllQueueStats returns empty array without Redis', async () => {
    const { getAllQueueStats } = await import('@/lib/queue/stats');
    const result = await getAllQueueStats();
    expect(result).toEqual([]);
  });
});
