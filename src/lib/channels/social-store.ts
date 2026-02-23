/**
 * In-memory social conversation storage with global singleton pattern.
 * Stores conversations and messages for Facebook, Instagram, and Twitter channels.
 * Follows the same pattern as sms-store.ts.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';

// ---- Types ----

export interface SocialMessage {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  body: string;
  externalMessageId?: string;
  timestamp: number;
}

export interface SocialConversation {
  id: string;
  platform: 'facebook' | 'instagram' | 'twitter';
  externalUserId: string;
  userName: string;
  status: 'active' | 'closed';
  messages: SocialMessage[];
  ticketId?: string;
  createdAt: number;
  lastActivity: number;
}

// ---- JSONL persistence ----

const SOCIAL_CONVERSATIONS_FILE = 'social-conversations.jsonl';

function persistConversations(
  store: Map<string, SocialConversation>,
): void {
  writeJsonlFile(SOCIAL_CONVERSATIONS_FILE, Array.from(store.values()));
}

// ---- Global singleton storage ----

declare global {
  // eslint-disable-next-line no-var
  var __cliasSocialCons: Map<string, SocialConversation> | undefined;
  // eslint-disable-next-line no-var
  var __cliasSocialConsLoaded: boolean | undefined;
}

function getStore(): Map<string, SocialConversation> {
  if (!global.__cliasSocialCons) {
    global.__cliasSocialCons = new Map();
  }
  // Load persisted conversations on first access
  if (!global.__cliasSocialConsLoaded) {
    global.__cliasSocialConsLoaded = true;
    const saved = readJsonlFile<SocialConversation>(SOCIAL_CONVERSATIONS_FILE);
    if (saved.length > 0) {
      for (const conv of saved) {
        global.__cliasSocialCons.set(conv.id, conv);
      }
    } else {
      // Seed demo conversations on first load
      seedDemoConversations(global.__cliasSocialCons);
    }
  }
  return global.__cliasSocialCons;
}

// ---- Demo seed data ----

function seedDemoConversations(
  store: Map<string, SocialConversation>,
): void {
  const now = Date.now();

  // Facebook Messenger conversation
  const fbConv: SocialConversation = {
    id: crypto.randomUUID(),
    platform: 'facebook',
    externalUserId: 'fb_10205629832457',
    userName: 'Sarah Chen',
    status: 'active',
    messages: [
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'inbound',
        body: 'Hi! I saw your product on Facebook. Can I get pricing for the enterprise plan?',
        timestamp: now - 5400000,
      },
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'outbound',
        body: 'Hello Sarah! Thanks for reaching out. Our enterprise plan starts at $299/month. Would you like to schedule a demo?',
        timestamp: now - 5300000,
      },
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'inbound',
        body: 'Yes, that would be great! How about this Thursday?',
        timestamp: now - 5200000,
      },
    ],
    createdAt: now - 5400000,
    lastActivity: now - 5200000,
  };
  for (const msg of fbConv.messages) {
    msg.conversationId = fbConv.id;
  }

  // Instagram DM conversation
  const igConv: SocialConversation = {
    id: crypto.randomUUID(),
    platform: 'instagram',
    externalUserId: 'ig_839201749382',
    userName: 'Alex Rivera',
    status: 'active',
    messages: [
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'inbound',
        body: 'Love your product! Quick question — does it integrate with Shopify?',
        timestamp: now - 9000000,
      },
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'outbound',
        body: 'Thanks Alex! Yes, we have a native Shopify integration. You can connect it in Settings > Integrations.',
        timestamp: now - 8800000,
      },
    ],
    createdAt: now - 9000000,
    lastActivity: now - 8800000,
  };
  for (const msg of igConv.messages) {
    msg.conversationId = igConv.id;
  }

  // Twitter DM conversation
  const twConv: SocialConversation = {
    id: crypto.randomUUID(),
    platform: 'twitter',
    externalUserId: 'tw_1593847261049',
    userName: 'Jordan Taylor',
    status: 'active',
    messages: [
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'inbound',
        body: 'Hey, I\'m having trouble with the API. Getting 429 errors on bulk imports.',
        timestamp: now - 1800000,
      },
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'outbound',
        body: 'Hi Jordan! 429 means you\'re hitting our rate limit. For bulk imports, try batching requests to 100/minute. I can also increase your limit if needed.',
        timestamp: now - 1700000,
      },
      {
        id: crypto.randomUUID(),
        conversationId: '',
        direction: 'inbound',
        body: 'Batching worked! Thanks for the quick help.',
        timestamp: now - 1600000,
      },
    ],
    createdAt: now - 1800000,
    lastActivity: now - 1600000,
  };
  for (const msg of twConv.messages) {
    msg.conversationId = twConv.id;
  }

  store.set(fbConv.id, fbConv);
  store.set(igConv.id, igConv);
  store.set(twConv.id, twConv);
  persistConversations(store);
}

// ---- Conversation operations ----

export function createConversation(
  platform: SocialConversation['platform'],
  externalUserId: string,
  userName?: string,
): SocialConversation {
  const store = getStore();
  const conversation: SocialConversation = {
    id: crypto.randomUUID(),
    platform,
    externalUserId,
    userName: userName ?? externalUserId,
    status: 'active',
    messages: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };

  store.set(conversation.id, conversation);
  persistConversations(store);
  return conversation;
}

export function getConversation(id: string): SocialConversation | undefined {
  return getStore().get(id);
}

export function getAllConversations(): SocialConversation[] {
  const store = getStore();
  return Array.from(store.values()).sort(
    (a, b) => b.lastActivity - a.lastActivity,
  );
}

export function getByPlatform(
  platform: SocialConversation['platform'],
): SocialConversation[] {
  return getAllConversations().filter((c) => c.platform === platform);
}

export function findByExternalUser(
  platform: SocialConversation['platform'],
  externalUserId: string,
): SocialConversation | undefined {
  const store = getStore();
  for (const conv of store.values()) {
    if (
      conv.platform === platform &&
      conv.externalUserId === externalUserId &&
      conv.status === 'active'
    ) {
      return conv;
    }
  }
  return undefined;
}

export function addMessage(
  conversationId: string,
  direction: SocialMessage['direction'],
  body: string,
  externalMessageId?: string,
): SocialMessage | null {
  const store = getStore();
  const conversation = store.get(conversationId);
  if (!conversation) return null;

  const message: SocialMessage = {
    id: crypto.randomUUID(),
    conversationId,
    direction,
    body,
    externalMessageId,
    timestamp: Date.now(),
  };

  conversation.messages.push(message);
  conversation.lastActivity = Date.now();
  store.set(conversationId, conversation);
  persistConversations(store);
  return message;
}

export function closeConversation(id: string): SocialConversation | null {
  const store = getStore();
  const conversation = store.get(id);
  if (!conversation) return null;

  conversation.status = 'closed';
  conversation.lastActivity = Date.now();
  store.set(id, conversation);
  persistConversations(store);
  return conversation;
}
