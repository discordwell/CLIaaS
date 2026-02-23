/**
 * Meta Graph API client for Facebook Messenger and Instagram DMs.
 * In demo mode (no META_PAGE_ACCESS_TOKEN), logs to console and returns mock data.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { createLogger } from '@/lib/logger';

const logger = createLogger('meta');

// ---- Types ----

export interface MetaConfig {
  pageAccessToken: string;
  appSecret: string;
  verifyToken: string;
  pageId: string;
}

export interface MetaMessage {
  senderId: string;
  recipientId: string;
  text: string;
  timestamp: number;
  messageId: string;
}

// ---- Configuration ----

export function getMetaConfig(): MetaConfig | null {
  const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN;
  const appSecret = process.env.META_APP_SECRET;
  const verifyToken = process.env.META_VERIFY_TOKEN;
  const pageId = process.env.META_PAGE_ID;

  if (!pageAccessToken || !appSecret || !verifyToken || !pageId) {
    return null;
  }

  return { pageAccessToken, appSecret, verifyToken, pageId };
}

export function isMetaDemoMode(): boolean {
  return !process.env.META_PAGE_ACCESS_TOKEN;
}

// ---- Webhook Verification ----

export function verifyWebhook(
  mode: string,
  token: string,
  challenge: string,
): string | null {
  const config = getMetaConfig();
  const verifyToken = config?.verifyToken ?? 'demo-verify-token';

  if (mode === 'subscribe' && token === verifyToken) {
    return challenge;
  }

  return null;
}

// ---- Parse Webhook Payload ----

export function parseWebhookPayload(body: Record<string, unknown> | null | undefined): MetaMessage[] {
  const messages: MetaMessage[] = [];

  if (!body?.entry || !Array.isArray(body.entry)) {
    return messages;
  }

  for (const entry of body.entry) {
    if (!entry.messaging || !Array.isArray(entry.messaging)) {
      continue;
    }

    for (const event of entry.messaging) {
      if (!event.message?.text) continue;

      messages.push({
        senderId: event.sender?.id ?? '',
        recipientId: event.recipient?.id ?? '',
        text: event.message.text,
        timestamp: event.timestamp ?? Date.now(),
        messageId: event.message.mid ?? '',
      });
    }
  }

  return messages;
}

// ---- Send Message ----

export async function sendMessage(
  recipientId: string,
  text: string,
  platform: 'facebook' | 'instagram',
): Promise<{ messageId: string }> {
  const config = getMetaConfig();

  // Demo mode: log and return mock ID
  if (!config) {
    const mockId = `mid.${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    logger.info({ platform, recipientId, text }, 'Demo outbound message');
    return { messageId: mockId };
  }

  // Production: POST to Graph API (token in Authorization header, not URL)
  const url = 'https://graph.facebook.com/v18.0/me/messages';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.pageAccessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: 'RESPONSE',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Meta Graph API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return { messageId: data.message_id };
}

// ---- Signature Validation ----

export function validateSignature(body: string, signature: string): boolean {
  // Demo mode: always valid
  if (isMetaDemoMode()) return true;

  const config = getMetaConfig();
  if (!config) return false;

  const expected = createHmac('sha256', config.appSecret)
    .update(body, 'utf-8')
    .digest('hex');

  const expectedHeader = `sha256=${expected}`;
  // Timing-safe comparison to prevent side-channel attacks
  const a = Buffer.from(expectedHeader);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
