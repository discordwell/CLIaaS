/**
 * Slack intake channel — signature verification, message-to-ticket mapping,
 * and JSONL-backed conversation/mapping stores.
 */

import { createLogger } from '../logger';
import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import crypto from 'crypto';

const logger = createLogger('channels:slack');

// ---- Types ----

export interface SlackMessageEvent {
  type: string;
  subtype?: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  event_ts?: string;
}

export interface SlackChannelMapping {
  id: string;
  workspaceId?: string;
  slackTeamId?: string;
  slackChannelId: string;
  slackChannelName: string;
  inboxId?: string;
  autoCreateTicket: boolean;
  createdAt: string;
}

export interface SlackConversation {
  id: string;
  slackChannelId: string;
  slackThreadTs?: string;
  slackUserId: string;
  ticketId?: string;
  messages: Array<{
    direction: 'inbound' | 'outbound';
    text: string;
    slackTs: string;
    timestamp: string;
  }>;
  createdAt: string;
  lastActivityAt: string;
}

// ---- Slack signature verification ----

export function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string,
): boolean {
  // Reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    logger.warn('Slack request timestamp too old');
    return false;
  }

  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(`v0=${hmac}`),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

// ---- Map a Slack message to ticket creation ----

export function messageToTicket(event: SlackMessageEvent, channelName: string) {
  return {
    subject: `Slack: ${channelName} — ${event.text?.slice(0, 60) || 'New message'}`,
    description: event.text || '',
    source: 'slack' as const,
    requester: event.user,
  };
}

// ---- JSONL persistence ----

const SLACK_MAPPINGS_FILE = 'slack-mappings.jsonl';
const SLACK_CONVERSATIONS_FILE = 'slack-conversations.jsonl';

function persistMappings(store: Map<string, SlackChannelMapping>): void {
  writeJsonlFile(SLACK_MAPPINGS_FILE, Array.from(store.values()));
}

function persistConversations(store: Map<string, SlackConversation>): void {
  writeJsonlFile(SLACK_CONVERSATIONS_FILE, Array.from(store.values()));
}

// ---- Global singleton storage ----

declare global {
  // eslint-disable-next-line no-var
  var __cliaasSlackMappings: Map<string, SlackChannelMapping> | undefined;
  // eslint-disable-next-line no-var
  var __cliaasSlackMappingsLoaded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __cliaasSlackConvs: Map<string, SlackConversation> | undefined;
  // eslint-disable-next-line no-var
  var __cliaasSlackConvsLoaded: boolean | undefined;
}

function getMappingStore(): Map<string, SlackChannelMapping> {
  if (!global.__cliaasSlackMappings) {
    global.__cliaasSlackMappings = new Map();
  }
  if (!global.__cliaasSlackMappingsLoaded) {
    global.__cliaasSlackMappingsLoaded = true;
    const saved = readJsonlFile<SlackChannelMapping>(SLACK_MAPPINGS_FILE);
    for (const m of saved) {
      global.__cliaasSlackMappings.set(m.id, m);
    }
  }
  return global.__cliaasSlackMappings;
}

function getConversationStore(): Map<string, SlackConversation> {
  if (!global.__cliaasSlackConvs) {
    global.__cliaasSlackConvs = new Map();
  }
  if (!global.__cliaasSlackConvsLoaded) {
    global.__cliaasSlackConvsLoaded = true;
    const saved = readJsonlFile<SlackConversation>(SLACK_CONVERSATIONS_FILE);
    for (const c of saved) {
      global.__cliaasSlackConvs.set(c.id, c);
    }
  }
  return global.__cliaasSlackConvs;
}

// ---- Mapping operations ----

export function getSlackMappings(workspaceId?: string): SlackChannelMapping[] {
  const store = getMappingStore();
  let mappings = Array.from(store.values());
  if (workspaceId) {
    mappings = mappings.filter(m => !m.workspaceId || m.workspaceId === workspaceId);
  }
  return mappings;
}

export function createSlackMapping(
  input: Omit<SlackChannelMapping, 'id' | 'createdAt'>,
): SlackChannelMapping {
  const store = getMappingStore();
  const mapping: SlackChannelMapping = {
    id: `slk-map-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
    createdAt: new Date().toISOString(),
  };
  store.set(mapping.id, mapping);
  persistMappings(store);
  logger.info({ mappingId: mapping.id, channel: input.slackChannelName }, 'Slack channel mapping created');
  return mapping;
}

export function deleteSlackMapping(id: string): boolean {
  const store = getMappingStore();
  const deleted = store.delete(id);
  if (deleted) {
    persistMappings(store);
    logger.info({ mappingId: id }, 'Slack channel mapping deleted');
  }
  return deleted;
}

export function findMappingByChannel(slackChannelId: string): SlackChannelMapping | undefined {
  const store = getMappingStore();
  for (const mapping of store.values()) {
    if (mapping.slackChannelId === slackChannelId) return mapping;
  }
  return undefined;
}

// ---- Conversation operations ----

export function findConversation(slackChannelId: string, slackUserId: string): SlackConversation | undefined {
  const store = getConversationStore();
  for (const conv of store.values()) {
    if (conv.slackChannelId === slackChannelId && conv.slackUserId === slackUserId) {
      return conv;
    }
  }
  return undefined;
}

export function createSlackConversation(
  slackChannelId: string,
  slackUserId: string,
  threadTs?: string,
): SlackConversation {
  const store = getConversationStore();
  const now = new Date().toISOString();
  const conv: SlackConversation = {
    id: `slk-conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    slackChannelId,
    slackThreadTs: threadTs,
    slackUserId,
    messages: [],
    createdAt: now,
    lastActivityAt: now,
  };
  store.set(conv.id, conv);
  persistConversations(store);
  return conv;
}

export function addSlackMessage(
  conversationId: string,
  direction: 'inbound' | 'outbound',
  text: string,
  slackTs: string,
): SlackConversation | null {
  const store = getConversationStore();
  const conv = store.get(conversationId);
  if (!conv) return null;

  const now = new Date().toISOString();
  conv.messages.push({ direction, text, slackTs, timestamp: now });
  conv.lastActivityAt = now;
  store.set(conversationId, conv);
  persistConversations(store);
  return conv;
}

export function setSlackConversationTicketId(conversationId: string, ticketId: string): void {
  const store = getConversationStore();
  const conv = store.get(conversationId);
  if (!conv) return;
  conv.ticketId = ticketId;
  store.set(conversationId, conv);
  persistConversations(store);
}

export function getSlackSigningSecret(): string {
  return process.env.SLACK_SIGNING_SECRET ?? '';
}

export function getSlackBotToken(): string {
  return process.env.SLACK_BOT_TOKEN ?? '';
}

export function getSlackClientId(): string {
  return process.env.SLACK_CLIENT_ID ?? '';
}

export function getSlackClientSecret(): string {
  return process.env.SLACK_CLIENT_SECRET ?? '';
}
