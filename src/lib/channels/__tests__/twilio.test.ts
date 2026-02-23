import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  parseInbound,
  validateSignature,
  generateTwiml,
  isDemoMode,
  sendMessage,
  getConfig,
} from '@/lib/channels/twilio';
import { createHmac } from 'crypto';

describe('twilio', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Ensure demo mode by default
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    delete process.env.TWILIO_WHATSAPP_NUMBER;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('parseInbound extracts form data fields', () => {
    const form = new FormData();
    form.set('MessageSid', 'SM123');
    form.set('From', '+15551234567');
    form.set('To', '+15559876543');
    form.set('Body', 'Hello support');
    form.set('NumMedia', '0');
    const msg = parseInbound(form);
    expect(msg.MessageSid).toBe('SM123');
    expect(msg.From).toBe('+15551234567');
    expect(msg.To).toBe('+15559876543');
    expect(msg.Body).toBe('Hello support');
    expect(msg.NumMedia).toBe('0');
  });

  it('isDemoMode returns true when env is not set', () => {
    expect(isDemoMode()).toBe(true);
  });

  it('validateSignature returns true in demo mode', () => {
    expect(
      validateSignature('https://example.com', { key: 'val' }, 'any-sig'),
    ).toBe(true);
  });

  it('generateTwiml produces valid XML with message', () => {
    const xml = generateTwiml('Thanks for your message');
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Message>Thanks for your message</Message>');
    expect(xml).toContain('</Response>');
  });

  it('generateTwiml produces empty response when no body', () => {
    const xml = generateTwiml();
    expect(xml).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  it('generateTwiml escapes XML entities', () => {
    const xml = generateTwiml('A & B < C');
    expect(xml).toContain('A &amp; B &lt; C');
  });
});
