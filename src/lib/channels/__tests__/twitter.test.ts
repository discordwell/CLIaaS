import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  handleCrcChallenge,
  parseAccountActivity,
  validateSignature,
  isTwitterDemoMode,
} from '@/lib/channels/twitter';
import { createHmac } from 'crypto';

describe('twitter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TWITTER_API_KEY;
    delete process.env.TWITTER_API_SECRET;
    delete process.env.TWITTER_ACCESS_TOKEN;
    delete process.env.TWITTER_ACCESS_TOKEN_SECRET;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('handleCrcChallenge returns sha256= prefixed HMAC', () => {
    const result = handleCrcChallenge('test-crc-token');
    expect(result).toMatch(/^sha256=/);
    // Verify with known demo secret
    const expected = createHmac('sha256', 'demo-secret')
      .update('test-crc-token')
      .digest('base64');
    expect(result).toBe(`sha256=${expected}`);
  });

  it('parseAccountActivity extracts DMs from valid payload', () => {
    const payload = {
      direct_message_events: [
        {
          type: 'message_create',
          id: 'dm-1',
          created_timestamp: '1700000000000',
          message_create: {
            sender_id: 'user-a',
            target: { recipient_id: 'user-b' },
            message_data: { text: 'Hey there' },
          },
        },
      ],
    };
    const dms = parseAccountActivity(payload);
    expect(dms).toHaveLength(1);
    expect(dms[0].id).toBe('dm-1');
    expect(dms[0].senderId).toBe('user-a');
    expect(dms[0].recipientId).toBe('user-b');
    expect(dms[0].text).toBe('Hey there');
  });

  it('parseAccountActivity returns empty for no events', () => {
    expect(parseAccountActivity(null)).toEqual([]);
    expect(parseAccountActivity({})).toEqual([]);
    expect(parseAccountActivity({ direct_message_events: [] })).toEqual([]);
  });

  it('parseAccountActivity skips non-message_create events', () => {
    const payload = {
      direct_message_events: [
        { type: 'read', id: 'dm-0', message_create: { message_data: {} } },
        {
          type: 'message_create',
          id: 'dm-1',
          message_create: {
            sender_id: 's1',
            target: { recipient_id: 'r1' },
            message_data: { text: 'Real DM' },
          },
        },
      ],
    };
    const dms = parseAccountActivity(payload);
    expect(dms).toHaveLength(1);
    expect(dms[0].text).toBe('Real DM');
  });

  it('isTwitterDemoMode returns true without env vars', () => {
    expect(isTwitterDemoMode()).toBe(true);
  });
});
