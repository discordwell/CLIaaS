import { describe, it, expect } from 'vitest';
import {
  escapeXml,
  generateGatherTwiml,
  generateTransferTwiml,
  generateVoicemailTwiml,
  generateSayTwiml,
  routeByDigit,
  type IVRMenu,
  type IVRConfig,
} from '@/lib/channels/voice-ivr';

const testMenu: IVRMenu = {
  id: 'main',
  name: 'Main Menu',
  greeting: 'Welcome to support',
  items: [
    { digit: '1', label: 'Sales', action: 'transfer', transferTo: '+15005550001' },
    { digit: '2', label: 'Support', action: 'transfer', transferTo: '+15005550002' },
    { digit: '0', label: 'voicemail', action: 'voicemail' },
  ],
  timeoutSeconds: 5,
  maxRetries: 2,
  fallbackAction: 'voicemail',
};

const testConfig: IVRConfig = {
  enabled: true,
  mainMenuId: 'main',
  menus: [testMenu],
  voicemailGreeting: 'Please leave a message.',
  businessHours: {
    enabled: false,
    timezone: 'America/New_York',
    schedule: {},
  },
  updatedAt: new Date().toISOString(),
};

describe('escapeXml', () => {
  it('escapes all XML entities', () => {
    expect(escapeXml('A & B < C > D "E" \'F\'')).toBe(
      'A &amp; B &lt; C &gt; D &quot;E&quot; &apos;F&apos;',
    );
  });

  it('passes through plain text unchanged', () => {
    expect(escapeXml('Hello World')).toBe('Hello World');
  });
});

describe('generateGatherTwiml', () => {
  it('produces valid TwiML with Gather and Say', () => {
    const xml = generateGatherTwiml(testMenu);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Gather');
    expect(xml).toContain('numDigits="1"');
    expect(xml).toContain('timeout="5"');
    expect(xml).toContain('<Say voice="alice">');
    expect(xml).toContain('Welcome to support');
    expect(xml).toContain('Press 1 for Sales');
    expect(xml).toContain('Press 2 for Support');
    expect(xml).toContain('</Response>');
  });

  it('includes action URL with menuId', () => {
    const xml = generateGatherTwiml(testMenu);
    expect(xml).toContain('action="/api/channels/voice/inbound?menuId=main"');
  });
});

describe('generateTransferTwiml', () => {
  it('produces Dial element with phone number', () => {
    const xml = generateTransferTwiml('+15005550001');
    expect(xml).toContain('<Dial');
    expect(xml).toContain('+15005550001');
    expect(xml).toContain('Transferring you now');
  });

  it('includes statusCallback when provided', () => {
    const xml = generateTransferTwiml('+15005550001', 'https://example.com/status');
    expect(xml).toContain('statusCallback="https://example.com/status"');
  });
});

describe('generateVoicemailTwiml', () => {
  it('produces Record element', () => {
    const xml = generateVoicemailTwiml('Leave a message.');
    expect(xml).toContain('<Record');
    expect(xml).toContain('maxLength="120"');
    expect(xml).toContain('Leave a message.');
    expect(xml).toContain('<Hangup />');
  });
});

describe('generateSayTwiml', () => {
  it('produces Say and Hangup', () => {
    const xml = generateSayTwiml('Goodbye');
    expect(xml).toContain('<Say voice="alice">Goodbye</Say>');
    expect(xml).toContain('<Hangup />');
  });
});

describe('routeByDigit', () => {
  it('routes to transfer for digit 1', () => {
    const xml = routeByDigit(testMenu, '1', testConfig);
    expect(xml).toContain('<Dial');
    expect(xml).toContain('+15005550001');
  });

  it('routes to voicemail for digit 0', () => {
    const xml = routeByDigit(testMenu, '0', testConfig);
    expect(xml).toContain('<Record');
    expect(xml).toContain('Please leave a message.');
  });

  it('replays menu for invalid digit', () => {
    const xml = routeByDigit(testMenu, '9', testConfig);
    expect(xml).toContain('<Gather');
    expect(xml).toContain('Welcome to support');
  });
});
