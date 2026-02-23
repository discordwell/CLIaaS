/**
 * X/Twitter DM client using Account Activity API and DM endpoints.
 * In demo mode (no TWITTER_API_KEY), logs to console and returns mock data.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { createLogger } from '@/lib/logger';

const logger = createLogger('twitter');

// ---- Types ----

export interface TwitterConfig {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  envName: string;
}

export interface TwitterDM {
  id: string;
  senderId: string;
  recipientId: string;
  text: string;
  createdAt: string;
}

// ---- Configuration ----

export function getTwitterConfig(): TwitterConfig | null {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessTokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;
  const envName = process.env.TWITTER_ENV_NAME ?? 'production';

  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    return null;
  }

  return { apiKey, apiSecret, accessToken, accessTokenSecret, envName };
}

export function isTwitterDemoMode(): boolean {
  return !process.env.TWITTER_API_KEY;
}

// ---- CRC Challenge ----

export function handleCrcChallenge(crcToken: string): string {
  const config = getTwitterConfig();
  const secret = config?.apiSecret ?? 'demo-secret';

  const hmac = createHmac('sha256', secret)
    .update(crcToken)
    .digest('base64');

  return `sha256=${hmac}`;
}

// ---- Parse Account Activity ----

export function parseAccountActivity(body: Record<string, unknown> | null | undefined): TwitterDM[] {
  const dms: TwitterDM[] = [];

  if (
    !body?.direct_message_events ||
    !Array.isArray(body.direct_message_events)
  ) {
    return dms;
  }

  for (const event of body.direct_message_events) {
    if (event.type !== 'message_create') continue;

    const messageData = event.message_create;
    if (!messageData?.message_data?.text) continue;

    dms.push({
      id: event.id ?? '',
      senderId: messageData.sender_id ?? '',
      recipientId: messageData.target?.recipient_id ?? '',
      text: messageData.message_data.text,
      createdAt: event.created_timestamp
        ? new Date(parseInt(event.created_timestamp, 10)).toISOString()
        : new Date().toISOString(),
    });
  }

  return dms;
}

// ---- Signature Validation ----

export function validateSignature(body: string, signature: string): boolean {
  if (isTwitterDemoMode()) return true;

  const config = getTwitterConfig();
  if (!config) return false;

  const expected = `sha256=${createHmac('sha256', config.apiSecret).update(body).digest('base64')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---- Send DM ----

export async function sendDM(
  recipientId: string,
  text: string,
): Promise<{ id: string }> {
  const config = getTwitterConfig();

  // Demo mode: log and return mock ID
  if (!config) {
    const mockId = `dm_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    logger.info({ recipientId, text }, 'Demo outbound DM');
    return { id: mockId };
  }

  // Production: POST to Twitter v2 DM endpoint
  const url = 'https://api.twitter.com/2/dm_conversations/with/' +
    `${recipientId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twitter API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return { id: data.data?.dm_event_id ?? data.data?.id ?? '' };
}
