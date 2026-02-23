/**
 * IVR (Interactive Voice Response) menu builder for Twilio Voice.
 * Generates TwiML XML for voice call handling.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';

// ---- Types ----

export interface IVRMenuItem {
  digit: string;        // '1', '2', etc.
  label: string;        // e.g. "Sales", "Support"
  action: 'transfer' | 'voicemail' | 'submenu' | 'say';
  transferTo?: string;  // phone number for transfer
  message?: string;     // TTS message for 'say'
  submenuId?: string;   // for nested menus
}

export interface IVRMenu {
  id: string;
  name: string;
  greeting: string;     // TTS greeting before menu options
  items: IVRMenuItem[];
  timeoutSeconds: number;
  maxRetries: number;
  fallbackAction: 'voicemail' | 'transfer' | 'hangup';
  fallbackTransferTo?: string;
}

export interface IVRConfig {
  enabled: boolean;
  mainMenuId: string;
  menus: IVRMenu[];
  voicemailGreeting: string;
  businessHours: {
    enabled: boolean;
    timezone: string;
    schedule: Record<string, { start: string; end: string } | null>; // 'mon' -> { start: '09:00', end: '17:00' }
  };
  updatedAt: string;
}

// ---- XML Escaping ----

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---- TwiML Generation ----

export function generateGatherTwiml(menu: IVRMenu, statusCallbackUrl?: string): string {
  const menuDescription = menu.items
    .map((item) => `Press ${item.digit} for ${item.label}`)
    .join('. ');

  const sayText = `${menu.greeting}. ${menuDescription}.`;

  let twiml = '<?xml version="1.0" encoding="UTF-8"?>';
  twiml += '<Response>';
  twiml += `<Gather numDigits="1" timeout="${menu.timeoutSeconds}" action="/api/channels/voice/inbound?menuId=${escapeXml(menu.id)}">`;
  twiml += `<Say voice="alice">${escapeXml(sayText)}</Say>`;
  twiml += '</Gather>';
  // Fallback if no input
  twiml += generateFallbackTwiml(menu, statusCallbackUrl);
  twiml += '</Response>';
  return twiml;
}

export function generateTransferTwiml(phoneNumber: string, statusCallbackUrl?: string): string {
  let twiml = '<?xml version="1.0" encoding="UTF-8"?>';
  twiml += '<Response>';
  twiml += `<Say voice="alice">Transferring you now. Please hold.</Say>`;
  twiml += `<Dial${statusCallbackUrl ? ` statusCallback="${escapeXml(statusCallbackUrl)}"` : ''}>`;
  twiml += escapeXml(phoneNumber);
  twiml += '</Dial>';
  twiml += '</Response>';
  return twiml;
}

export function generateVoicemailTwiml(greeting: string, statusCallbackUrl?: string): string {
  let twiml = '<?xml version="1.0" encoding="UTF-8"?>';
  twiml += '<Response>';
  twiml += `<Say voice="alice">${escapeXml(greeting)}</Say>`;
  twiml += `<Record maxLength="120" transcribe="true"${statusCallbackUrl ? ` recordingStatusCallback="${escapeXml(statusCallbackUrl)}"` : ''} />`;
  twiml += '<Say voice="alice">Thank you for your message. Goodbye.</Say>';
  twiml += '<Hangup />';
  twiml += '</Response>';
  return twiml;
}

export function generateSayTwiml(message: string): string {
  let twiml = '<?xml version="1.0" encoding="UTF-8"?>';
  twiml += '<Response>';
  twiml += `<Say voice="alice">${escapeXml(message)}</Say>`;
  twiml += '<Hangup />';
  twiml += '</Response>';
  return twiml;
}

function generateFallbackTwiml(menu: IVRMenu, statusCallbackUrl?: string): string {
  switch (menu.fallbackAction) {
    case 'voicemail':
      return `<Say voice="alice">We didn&apos;t receive your selection. Please leave a message after the tone.</Say><Record maxLength="120" transcribe="true"${statusCallbackUrl ? ` recordingStatusCallback="${escapeXml(statusCallbackUrl)}"` : ''} /><Hangup />`;
    case 'transfer':
      if (menu.fallbackTransferTo) {
        return `<Say voice="alice">Connecting you to an agent.</Say><Dial${statusCallbackUrl ? ` statusCallback="${escapeXml(statusCallbackUrl)}"` : ''}>${escapeXml(menu.fallbackTransferTo)}</Dial>`;
      }
      return '<Say voice="alice">We&apos;re unable to connect you right now. Please try again later.</Say><Hangup />';
    case 'hangup':
    default:
      return '<Say voice="alice">Thank you for calling. Goodbye.</Say><Hangup />';
  }
}

export function routeByDigit(
  menu: IVRMenu,
  digit: string,
  config: IVRConfig,
  statusCallbackUrl?: string,
): string {
  const item = menu.items.find((i) => i.digit === digit);

  if (!item) {
    // Invalid digit — replay the menu
    return generateGatherTwiml(menu, statusCallbackUrl);
  }

  switch (item.action) {
    case 'transfer':
      return generateTransferTwiml(item.transferTo ?? '', statusCallbackUrl);
    case 'voicemail':
      return generateVoicemailTwiml(
        config.voicemailGreeting,
        statusCallbackUrl,
      );
    case 'submenu': {
      const sub = config.menus.find((m) => m.id === item.submenuId);
      if (sub) return generateGatherTwiml(sub, statusCallbackUrl);
      return generateSayTwiml('Sorry, that option is not available right now.');
    }
    case 'say':
      return generateSayTwiml(item.message ?? 'Thank you for calling.');
    default:
      return generateGatherTwiml(menu, statusCallbackUrl);
  }
}

// ---- Persistence ----

const IVR_CONFIG_FILE = 'voice-ivr-config.jsonl';

let cachedConfig: IVRConfig | null = null;

export function getIVRConfig(): IVRConfig {
  if (cachedConfig) return cachedConfig;

  const saved = readJsonlFile<IVRConfig>(IVR_CONFIG_FILE);
  if (saved.length > 0) {
    cachedConfig = saved[0];
    return cachedConfig;
  }

  // Default IVR config
  cachedConfig = {
    enabled: true,
    mainMenuId: 'main',
    menus: [
      {
        id: 'main',
        name: 'Main Menu',
        greeting: 'Thank you for calling CLIaaS support',
        items: [
          { digit: '1', label: 'Sales', action: 'transfer', transferTo: '+15005550001' },
          { digit: '2', label: 'Technical Support', action: 'transfer', transferTo: '+15005550002' },
          { digit: '3', label: 'Billing', action: 'transfer', transferTo: '+15005550003' },
          { digit: '0', label: 'leave a voicemail', action: 'voicemail' },
        ],
        timeoutSeconds: 5,
        maxRetries: 2,
        fallbackAction: 'voicemail',
      },
    ],
    voicemailGreeting: 'Sorry we missed your call. Please leave a message and we will get back to you shortly.',
    businessHours: {
      enabled: false,
      timezone: 'America/New_York',
      schedule: {
        mon: { start: '09:00', end: '17:00' },
        tue: { start: '09:00', end: '17:00' },
        wed: { start: '09:00', end: '17:00' },
        thu: { start: '09:00', end: '17:00' },
        fri: { start: '09:00', end: '17:00' },
        sat: null,
        sun: null,
      },
    },
    updatedAt: new Date().toISOString(),
  };

  return cachedConfig;
}

export function saveIVRConfig(config: IVRConfig): void {
  config.updatedAt = new Date().toISOString();
  cachedConfig = config;
  writeJsonlFile(IVR_CONFIG_FILE, [config]);
}
