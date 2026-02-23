/**
 * Twilio REST API client for SMS and WhatsApp messaging.
 * In demo mode (no TWILIO_ACCOUNT_SID), logs to console and returns mock data.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { createLogger } from '@/lib/logger';

const logger = createLogger('twilio');

// ---- Types ----

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;       // SMS sender
  whatsappNumber: string;    // WhatsApp sender (whatsapp:+1...)
}

export interface OutboundMessage {
  to: string;
  body: string;
  channel: 'sms' | 'whatsapp';
}

export interface TwilioResponse {
  sid: string;
  status: string;
  to: string;
  from: string;
  body: string;
}

export interface InboundMessage {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia?: string;
}

// ---- Configuration ----

export function getConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
  const whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;

  if (!accountSid || !authToken || !phoneNumber || !whatsappNumber) {
    return null;
  }

  return { accountSid, authToken, phoneNumber, whatsappNumber };
}

export function isDemoMode(): boolean {
  return !process.env.TWILIO_ACCOUNT_SID;
}

// ---- Send Message ----

export async function sendMessage(msg: OutboundMessage): Promise<TwilioResponse> {
  const config = getConfig();

  // Demo mode: log and return mock
  if (!config) {
    const mockSid = `SM${crypto.randomUUID().replace(/-/g, '').slice(0, 32)}`;
    const from = msg.channel === 'whatsapp' ? 'whatsapp:+15005550006' : '+15005550006';
    const to = msg.channel === 'whatsapp' && !msg.to.startsWith('whatsapp:')
      ? `whatsapp:${msg.to}`
      : msg.to;

    logger.info({ channel: msg.channel, to, body: msg.body }, 'Demo outbound message');

    return {
      sid: mockSid,
      status: 'queued',
      to,
      from,
      body: msg.body,
    };
  }

  // Production: call Twilio REST API
  const from = msg.channel === 'whatsapp' ? config.whatsappNumber : config.phoneNumber;
  const to = msg.channel === 'whatsapp' && !msg.to.startsWith('whatsapp:')
    ? `whatsapp:${msg.to}`
    : msg.to;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  const credentials = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');

  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: msg.body,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twilio API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  return {
    sid: data.sid,
    status: data.status,
    to: data.to,
    from: data.from,
    body: data.body,
  };
}

// ---- Make Outbound Call ----

export async function makeCall(to: string, twimlUrl: string): Promise<{ sid: string; status: string }> {
  const config = getConfig();

  if (!config) {
    const mockSid = `CA${crypto.randomUUID().replace(/-/g, '').slice(0, 32)}`;
    logger.info({ to, twimlUrl }, 'Demo outbound call');
    return { sid: mockSid, status: 'queued' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls.json`;
  const credentials = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');

  const body = new URLSearchParams({
    To: to,
    From: config.phoneNumber,
    Url: twimlUrl,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twilio API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return { sid: data.sid, status: data.status };
}

// ---- Parse Inbound ----

export function parseInbound(formData: FormData): InboundMessage {
  return {
    MessageSid: formData.get('MessageSid') as string ?? '',
    From: formData.get('From') as string ?? '',
    To: formData.get('To') as string ?? '',
    Body: formData.get('Body') as string ?? '',
    NumMedia: formData.get('NumMedia') as string ?? '0',
  };
}

// ---- Validate Signature ----

export function validateSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  // In demo mode, always valid
  if (isDemoMode()) return true;

  const config = getConfig();
  if (!config) return false;

  // Build validation string: URL + sorted params key+value
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const computed = createHmac('sha1', config.authToken)
    .update(data, 'utf-8')
    .digest('base64');

  // Timing-safe comparison to prevent side-channel attacks
  const a = Buffer.from(computed);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---- TwiML Generation ----

export function generateTwiml(body?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body ? `<Message>${escapeXml(body)}</Message>` : ''}</Response>`;
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
