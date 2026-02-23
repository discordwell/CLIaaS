import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';

const TEST_DIR = '/tmp/cliaas-test-push-' + process.pid;

describe('push', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.CLIAAS_DATA_DIR = TEST_DIR;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    // No VAPID keys = demo mode
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    // Clean global singleton state
    (global as Record<string, unknown>).__cliaaPushSubs = undefined;
    (global as Record<string, unknown>).__cliaaPushSubsLoaded = undefined;
  });

  it('isDemoMode returns true without VAPID keys', async () => {
    const { isDemoMode } = await import('@/lib/push');
    expect(isDemoMode()).toBe(true);
  });

  it('getVapidConfig returns null without keys', async () => {
    const { getVapidConfig } = await import('@/lib/push');
    expect(getVapidConfig()).toBeNull();
  });

  it('addSubscription stores and returns subscription', async () => {
    const { addSubscription, listSubscriptions } = await import('@/lib/push');

    const sub = addSubscription(
      'https://push.example.com/sub/123',
      { p256dh: 'key1', auth: 'auth1' },
      'user-1',
    );

    expect(sub.id).toBeTruthy();
    expect(sub.endpoint).toBe('https://push.example.com/sub/123');
    expect(sub.keys.p256dh).toBe('key1');
    expect(sub.userId).toBe('user-1');

    const all = listSubscriptions();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.find((s) => s.id === sub.id)).toBeDefined();
  });

  it('removeSubscription removes by endpoint', async () => {
    const { addSubscription, removeSubscription, listSubscriptions } =
      await import('@/lib/push');

    addSubscription(
      'https://push.example.com/sub/to-remove',
      { p256dh: 'k', auth: 'a' },
    );

    const before = listSubscriptions().length;
    const removed = removeSubscription('https://push.example.com/sub/to-remove');
    expect(removed).toBe(true);
    expect(listSubscriptions().length).toBe(before - 1);
  });

  it('removeSubscription returns false for unknown endpoint', async () => {
    const { removeSubscription } = await import('@/lib/push');
    expect(removeSubscription('https://unknown.example.com')).toBe(false);
  });

  it('sendPush in demo mode returns mock success', async () => {
    const { sendPush, addSubscription } = await import('@/lib/push');

    addSubscription('https://push.example.com/demo', { p256dh: 'k', auth: 'a' });

    const result = await sendPush({
      title: 'Test',
      body: 'Test notification',
    });

    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);
  });
});
