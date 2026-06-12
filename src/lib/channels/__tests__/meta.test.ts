import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseWebhookPayload,
  verifyWebhook,
  validateSignature,
  isMetaDemoMode,
} from '@/lib/channels/meta';
import { createHmac } from 'crypto';

describe('meta', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.META_PAGE_ACCESS_TOKEN;
    delete process.env.META_APP_SECRET;
    delete process.env.META_VERIFY_TOKEN;
    delete process.env.META_PAGE_ID;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('parseWebhookPayload extracts messages from valid payload', () => {
    const payload = {
      entry: [
        {
          messaging: [
            {
              sender: { id: 'sender-1' },
              recipient: { id: 'page-1' },
              timestamp: 1700000000000,
              message: { mid: 'mid.1', text: 'Hello' },
            },
          ],
        },
      ],
    };
    const msgs = parseWebhookPayload(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].senderId).toBe('sender-1');
    expect(msgs[0].text).toBe('Hello');
    expect(msgs[0].messageId).toBe('mid.1');
  });

  it('parseWebhookPayload returns empty for null body', () => {
    expect(parseWebhookPayload(null)).toEqual([]);
  });

  it('parseWebhookPayload returns empty for malformed body', () => {
    expect(parseWebhookPayload({ entry: 'not-array' })).toEqual([]);
    expect(parseWebhookPayload({ entry: [{ messaging: 'bad' }] })).toEqual([]);
  });

  it('parseWebhookPayload skips events without text', () => {
    const payload = {
      entry: [
        {
          messaging: [
            { sender: { id: 's1' }, message: { mid: 'm1' } }, // no text
            { sender: { id: 's2' }, message: { mid: 'm2', text: 'Hi' } },
          ],
        },
      ],
    };
    const msgs = parseWebhookPayload(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe('Hi');
  });

  it('verifyWebhook returns challenge for matching subscribe mode', () => {
    const result = verifyWebhook('subscribe', 'demo-verify-token', 'challenge-123');
    expect(result).toBe('challenge-123');
  });

  it('verifyWebhook returns null for wrong token', () => {
    const result = verifyWebhook('subscribe', 'wrong-token', 'challenge-123');
    expect(result).toBeNull();
  });

  it('verifyWebhook fails closed in production when Meta is unconfigured', () => {
    process.env.NODE_ENV = 'production';
    // No META_* env (deleted in beforeEach): must NOT honor the public demo token.
    expect(verifyWebhook('subscribe', 'demo-verify-token', 'challenge-123')).toBeNull();
  });

  it('verifyWebhook still honors the demo token outside production (local setup)', () => {
    process.env.NODE_ENV = 'development';
    expect(verifyWebhook('subscribe', 'demo-verify-token', 'challenge-123')).toBe('challenge-123');
  });
});
