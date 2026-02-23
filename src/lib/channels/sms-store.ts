/**
 * In-memory SMS/WhatsApp conversation storage with global singleton pattern.
 * Stores conversations and messages for the channels feature.
 * Follows the same pattern as lib/chat.ts.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';

// ---- Types ----

export interface SmsMessage {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  body: string;
  sid?: string;
  timestamp: number;
}

export interface SmsConversation {
  id: string;
  phoneNumber: string;
  channel: 'sms' | 'whatsapp';
  customerName: string;
  status: 'active' | 'closed';
  messages: SmsMessage[];
  ticketId?: string;
  createdAt: number;
  lastActivity: number;
}

// ---- JSONL persistence ----

const SMS_CONVERSATIONS_FILE = 'sms-conversations.jsonl';

function persistConversations(store: Map<string, SmsConversation>): void {
  writeJsonlFile(SMS_CONVERSATIONS_FILE, Array.from(store.values()));
}

// ---- Global singleton storage ----

declare global {
  // eslint-disable-next-line no-var
  var __cliaasSmsCons: Map<string, SmsConversation> | undefined;
  // eslint-disable-next-line no-var
  var __cliaasSmsConsLoaded: boolean | undefined;
}

function getStore(): Map<string, SmsConversation> {
  if (!global.__cliaasSmsCons) {
    global.__cliaasSmsCons = new Map();
  }
  // Load persisted conversations on first access
  if (!global.__cliaasSmsConsLoaded) {
    global.__cliaasSmsConsLoaded = true;
    const saved = readJsonlFile<SmsConversation>(SMS_CONVERSATIONS_FILE);
    if (saved.length > 0) {
      for (const conv of saved) {
        global.__cliaasSmsCons.set(conv.id, conv);
      }
    } else {
      // Seed demo conversations on first load
      seedDemoConversations(global.__cliaasSmsCons);
    }
  }
  return global.__cliaasSmsCons;
}

// ---- Demo seed data ----

function seedDemoConversations(store: Map<string, SmsConversation>): void {
  const now = Date.now();

  const conv1: SmsConversation = {
    id: crypto.randomUUID(),
    phoneNumber: '+14155551234',
    channel: 'sms',
    customerName: 'Maria Garcia',
    status: 'active',
    messages: [
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'inbound',
        body: 'Hi, I need help resetting my password. I keep getting an error.',
        timestamp: now - 3600000,
      },
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'outbound',
        body: 'Hello Maria! I can help with that. Can you tell me the email address on your account?',
        timestamp: now - 3500000,
      },
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'inbound',
        body: 'It\'s maria.g@example.com',
        timestamp: now - 3400000,
      },
    ],
    createdAt: now - 3600000,
    lastActivity: now - 3400000,
  };
  // Set conversationId on messages
  for (const msg of conv1.messages) {
    msg.conversationId = conv1.id;
  }

  const conv2: SmsConversation = {
    id: crypto.randomUUID(),
    phoneNumber: '+447700900123',
    channel: 'whatsapp',
    customerName: 'James Wilson',
    status: 'active',
    messages: [
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'inbound',
        body: 'When will my order #4521 be shipped?',
        timestamp: now - 7200000,
      },
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'outbound',
        body: 'Hi James! Let me check on order #4521 for you. One moment please.',
        timestamp: now - 7100000,
      },
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'outbound',
        body: 'Your order shipped this morning. Tracking number: 1Z999AA10123456784. It should arrive in 2-3 business days.',
        timestamp: now - 7000000,
      },
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'inbound',
        body: 'Great, thanks!',
        timestamp: now - 6900000,
      },
    ],
    createdAt: now - 7200000,
    lastActivity: now - 6900000,
  };
  for (const msg of conv2.messages) {
    msg.conversationId = conv2.id;
  }

  store.set(conv1.id, conv1);
  store.set(conv2.id, conv2);
  persistConversations(store);
}

// ---- Conversation operations ----

export function createConversation(
  phoneNumber: string,
  channel: 'sms' | 'whatsapp',
  customerName?: string,
): SmsConversation {
  const store = getStore();
  const conversation: SmsConversation = {
    id: crypto.randomUUID(),
    phoneNumber,
    channel,
    customerName: customerName ?? phoneNumber,
    status: 'active',
    messages: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };

  store.set(conversation.id, conversation);
  persistConversations(store);
  return conversation;
}

export function getConversation(id: string): SmsConversation | undefined {
  return getStore().get(id);
}

export function getAllConversations(): SmsConversation[] {
  const store = getStore();
  return Array.from(store.values()).sort(
    (a, b) => b.lastActivity - a.lastActivity,
  );
}

export function addMessage(
  conversationId: string,
  direction: SmsMessage['direction'],
  body: string,
  sid?: string,
): SmsMessage | null {
  const store = getStore();
  const conversation = store.get(conversationId);
  if (!conversation) return null;

  const message: SmsMessage = {
    id: crypto.randomUUID(),
    conversationId,
    direction,
    body,
    sid,
    timestamp: Date.now(),
  };

  conversation.messages.push(message);
  conversation.lastActivity = Date.now();
  store.set(conversationId, conversation);
  persistConversations(store);
  return message;
}

export function findByPhone(phoneNumber: string): SmsConversation | undefined {
  const store = getStore();
  // Normalize: strip whatsapp: prefix for comparison
  const normalized = phoneNumber.replace(/^whatsapp:/, '');
  for (const conv of store.values()) {
    if (conv.phoneNumber === normalized || conv.phoneNumber === phoneNumber) {
      if (conv.status === 'active') return conv;
    }
  }
  return undefined;
}

export function closeConversation(id: string): SmsConversation | null {
  const store = getStore();
  const conversation = store.get(id);
  if (!conversation) return null;

  conversation.status = 'closed';
  conversation.lastActivity = Date.now();
  store.set(id, conversation);
  persistConversations(store);
  return conversation;
}
