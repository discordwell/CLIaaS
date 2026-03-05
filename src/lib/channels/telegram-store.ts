/**
 * Telegram config + conversation store — JSONL-backed in-memory storage.
 * Follows the same pattern as src/lib/channels/sms-store.ts.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';

// ---- Types ----

export interface TelegramConfig {
  id: string;
  workspaceId?: string;
  botToken: string;
  botUsername?: string;
  webhookSecret: string;
  inboxId?: string;
  createdAt: string;
}

export interface TelegramMessage {
  direction: 'inbound' | 'outbound';
  text: string;
  telegramMessageId?: number;
  timestamp: string;
}

export interface TelegramConversation {
  id: string;
  chatId: string;
  customerName?: string;
  ticketId?: string;
  messages: TelegramMessage[];
  createdAt: string;
  lastActivityAt: string;
}

// ---- JSONL persistence ----

const TELEGRAM_CONFIG_FILE = 'telegram-config.jsonl';
const TELEGRAM_CONVERSATIONS_FILE = 'telegram-conversations.jsonl';

function persistConfigs(store: Map<string, TelegramConfig>): void {
  writeJsonlFile(TELEGRAM_CONFIG_FILE, Array.from(store.values()));
}

function persistConversations(store: Map<string, TelegramConversation>): void {
  writeJsonlFile(TELEGRAM_CONVERSATIONS_FILE, Array.from(store.values()));
}

// ---- Global singleton storage ----

declare global {
  // eslint-disable-next-line no-var
  var __cliaasTelegramConfigs: Map<string, TelegramConfig> | undefined;
  // eslint-disable-next-line no-var
  var __cliaasTelegramConfigsLoaded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __cliaasTelegramConvs: Map<string, TelegramConversation> | undefined;
  // eslint-disable-next-line no-var
  var __cliaasTelegramConvsLoaded: boolean | undefined;
}

function getConfigStore(): Map<string, TelegramConfig> {
  if (!global.__cliaasTelegramConfigs) {
    global.__cliaasTelegramConfigs = new Map();
  }
  if (!global.__cliaasTelegramConfigsLoaded) {
    global.__cliaasTelegramConfigsLoaded = true;
    const saved = readJsonlFile<TelegramConfig>(TELEGRAM_CONFIG_FILE);
    for (const cfg of saved) {
      global.__cliaasTelegramConfigs.set(cfg.id, cfg);
    }
  }
  return global.__cliaasTelegramConfigs;
}

function getConversationStore(): Map<string, TelegramConversation> {
  if (!global.__cliaasTelegramConvs) {
    global.__cliaasTelegramConvs = new Map();
  }
  if (!global.__cliaasTelegramConvsLoaded) {
    global.__cliaasTelegramConvsLoaded = true;
    const saved = readJsonlFile<TelegramConversation>(TELEGRAM_CONVERSATIONS_FILE);
    for (const conv of saved) {
      global.__cliaasTelegramConvs.set(conv.id, conv);
    }
  }
  return global.__cliaasTelegramConvs;
}

// ---- Config operations ----

export function getTelegramConfig(workspaceId?: string): TelegramConfig | undefined {
  const store = getConfigStore();
  for (const cfg of store.values()) {
    if (!workspaceId || !cfg.workspaceId || cfg.workspaceId === workspaceId) {
      return cfg;
    }
  }
  return undefined;
}

export function saveTelegramConfig(config: Omit<TelegramConfig, 'id' | 'createdAt'> & { id?: string }): TelegramConfig {
  const store = getConfigStore();
  const saved: TelegramConfig = {
    id: config.id ?? `tg-cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: config.workspaceId,
    botToken: config.botToken,
    botUsername: config.botUsername,
    webhookSecret: config.webhookSecret,
    inboxId: config.inboxId,
    createdAt: new Date().toISOString(),
  };
  store.set(saved.id, saved);
  persistConfigs(store);
  return saved;
}

// ---- Conversation operations ----

export function findConversationByChatId(chatId: string): TelegramConversation | undefined {
  const store = getConversationStore();
  for (const conv of store.values()) {
    if (conv.chatId === chatId) return conv;
  }
  return undefined;
}

export function createConversation(chatId: string, customerName?: string): TelegramConversation {
  const store = getConversationStore();
  const now = new Date().toISOString();
  const conv: TelegramConversation = {
    id: `tg-conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chatId,
    customerName,
    messages: [],
    createdAt: now,
    lastActivityAt: now,
  };
  store.set(conv.id, conv);
  persistConversations(store);
  return conv;
}

export function addMessage(
  conversationId: string,
  direction: TelegramMessage['direction'],
  text: string,
  telegramMessageId?: number,
): TelegramConversation | null {
  const store = getConversationStore();
  const conv = store.get(conversationId);
  if (!conv) return null;

  const now = new Date().toISOString();
  conv.messages.push({
    direction,
    text,
    telegramMessageId,
    timestamp: now,
  });
  conv.lastActivityAt = now;
  store.set(conversationId, conv);
  persistConversations(store);
  return conv;
}

export function getAllConversations(): TelegramConversation[] {
  const store = getConversationStore();
  return Array.from(store.values()).sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );
}

export function setTicketId(conversationId: string, ticketId: string): void {
  const store = getConversationStore();
  const conv = store.get(conversationId);
  if (!conv) return;
  conv.ticketId = ticketId;
  store.set(conversationId, conv);
  persistConversations(store);
}
