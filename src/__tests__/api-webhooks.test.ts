import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'crypto';

describe('Channel webhook routes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Ensure demo mode for all channel integrations
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.META_PAGE_ACCESS_TOKEN;
    delete process.env.TWITTER_API_KEY;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // -- POST /api/channels/sms/inbound --

  describe('POST /api/channels/sms/inbound', () => {
    it('returns TwiML XML response for valid inbound SMS', async () => {
      const { POST } = await import('@/app/api/channels/sms/inbound/route');

      const formData = new FormData();
      formData.set('MessageSid', 'SM_test_123');
      formData.set('From', '+15551234567');
      formData.set('To', '+15559876543');
      formData.set('Body', 'I need help with my account');
      formData.set('NumMedia', '0');

      const req = new NextRequest('http://localhost:3000/api/channels/sms/inbound', {
        method: 'POST',
        body: formData,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/xml');

      const text = await res.text();
      expect(text).toContain('<?xml');
      expect(text).toContain('<Response>');
    });

    it('returns TwiML for WhatsApp-prefixed inbound messages', async () => {
      const { POST } = await import('@/app/api/channels/sms/inbound/route');

      const formData = new FormData();
      formData.set('MessageSid', 'SM_whatsapp_456');
      formData.set('From', 'whatsapp:+447700900123');
      formData.set('To', 'whatsapp:+15559876543');
      formData.set('Body', 'Question about my order');
      formData.set('NumMedia', '0');

      const req = new NextRequest('http://localhost:3000/api/channels/sms/inbound', {
        method: 'POST',
        body: formData,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('<Response>');
    });
  });

  // -- GET /api/channels/facebook/webhook --

  describe('GET /api/channels/facebook/webhook', () => {
    it('returns challenge when verify token matches', async () => {
      const { GET } = await import('@/app/api/channels/facebook/webhook/route');

      // In demo mode, the verify token is 'demo-verify-token'
      const url =
        'http://localhost:3000/api/channels/facebook/webhook' +
        '?hub.mode=subscribe&hub.verify_token=demo-verify-token&hub.challenge=test_challenge_123';

      const req = new NextRequest(url);
      const res = await GET(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('test_challenge_123');
    });

    it('returns 403 when verify token does not match', async () => {
      const { GET } = await import('@/app/api/channels/facebook/webhook/route');

      const url =
        'http://localhost:3000/api/channels/facebook/webhook' +
        '?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=test_challenge';

      const req = new NextRequest(url);
      const res = await GET(req);
      expect(res.status).toBe(403);
    });
  });

  // -- POST /api/channels/facebook/webhook --

  describe('POST /api/channels/facebook/webhook', () => {
    it('processes a valid messenger webhook payload', async () => {
      const { POST } = await import('@/app/api/channels/facebook/webhook/route');

      const payload = {
        object: 'page',
        entry: [
          {
            id: 'page_123',
            time: Date.now(),
            messaging: [
              {
                sender: { id: 'user_456' },
                recipient: { id: 'page_123' },
                timestamp: Date.now(),
                message: {
                  mid: 'mid.test123',
                  text: 'Hello from Facebook!',
                },
              },
            ],
          },
        ],
      };

      const req = new NextRequest('http://localhost:3000/api/channels/facebook/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });
  });

  // -- GET /api/channels/twitter/webhook --

  describe('GET /api/channels/twitter/webhook (CRC challenge)', () => {
    it('returns response_token for CRC challenge', async () => {
      const { GET } = await import('@/app/api/channels/twitter/webhook/route');

      const crcToken = 'test-crc-token-abc123';
      const url = `http://localhost:3000/api/channels/twitter/webhook?crc_token=${crcToken}`;
      const req = new NextRequest(url);

      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.response_token).toBeDefined();
      expect(body.response_token).toMatch(/^sha256=/);

      // Verify the HMAC is computed correctly (uses 'demo-secret' in demo mode)
      const expected = createHmac('sha256', 'demo-secret')
        .update(crcToken)
        .digest('base64');
      expect(body.response_token).toBe(`sha256=${expected}`);
    });

    it('returns 400 when crc_token is missing', async () => {
      const { GET } = await import('@/app/api/channels/twitter/webhook/route');

      const req = new NextRequest('http://localhost:3000/api/channels/twitter/webhook');
      const res = await GET(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/crc_token/i);
    });
  });

  // -- POST /api/channels/twitter/webhook --

  describe('POST /api/channels/twitter/webhook', () => {
    it('processes a valid DM event payload', async () => {
      const { POST } = await import('@/app/api/channels/twitter/webhook/route');

      const payload = {
        for_user_id: 'bot_user_123',
        direct_message_events: [
          {
            type: 'message_create',
            id: 'dm_event_001',
            created_timestamp: String(Date.now()),
            message_create: {
              sender_id: 'sender_789',
              target: { recipient_id: 'bot_user_123' },
              message_data: {
                text: 'Hello from Twitter DM!',
              },
            },
          },
        ],
      };

      const req = new NextRequest('http://localhost:3000/api/channels/twitter/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });
  });
});
