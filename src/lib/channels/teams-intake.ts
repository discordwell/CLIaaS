/**
 * MS Teams intake channel — Bot Framework REST API client (no SDK).
 * Provides token management, message sending, and JSONL-backed stores.
 */

import { createLogger } from '../logger';
import { readJsonlFile, writeJsonlFile } from '../jsonl-store';

const logger = createLogger('channels:teams');

// ---- Bot Framework API ----

export async function getTeamsToken(appId: string, appPassword: string): Promise<string> {
  const res = await fetch('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: appId,
      client_secret: appPassword,
      scope: 'https://api.botframework.com/.default',
    }),
  });
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

// Bot Framework allowed service URL patterns (SSRF prevention)
const ALLOWED_SERVICE_URL_PATTERNS = [
  /^https:\/\/smba\.trafficmanager\.net\//,
  /^https:\/\/[a-z0-9-]+\.botframework\.com\//,
  /^https:\/\/[a-z0-9-]+\.servicebus\.windows\.net\//,
];

function isAllowedServiceUrl(url: string): boolean {
  return ALLOWED_SERVICE_URL_PATTERNS.some(p => p.test(url));
}

export async function sendTeamsMessage(
  serviceUrl: string,
  conversationId: string,
  activityId: string,
  text: string,
  token: string,
): Promise<void> {
  if (!isAllowedServiceUrl(serviceUrl)) {
    logger.warn({ serviceUrl }, 'Blocked Teams message to untrusted serviceUrl');
    throw new Error('Untrusted serviceUrl — possible SSRF attempt');
  }
  await fetch(`${serviceUrl}/v3/conversations/${conversationId}/activities`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'message',
      text,
      replyToId: activityId,
    }),
  });
}

export async function verifyTeamsToken(authHeader: string): Promise<boolean> {
  // In production, validate JWT against Bot Framework JWKS
  // For now, check that header exists and is Bearer format
  return authHeader?.startsWith('Bearer ') ?? false;
}

// ---- Types ----

export interface TeamsConfig {
  id: string;
  workspaceId?: string;
  appId: string;
  appPassword: string;
  botName?: string;
  createdAt: string;
}

export interface TeamsChannelMapping {
  id: string;
  workspaceId?: string;
  teamsChannelId: string;
  teamsChannelName: string;
  inboxId?: string;
  autoCreateTicket: boolean;
  createdAt: string;
}

export interface TeamsConversation {
  id: string;
  teamsConversationId: string;
  serviceUrl: string;
  userName?: string;
  tenantId?: string;
  ticketId?: string;
  messages: Array<{
    direction: 'inbound' | 'outbound';
    text: string;
    activityId: string;
    timestamp: string;
  }>;
  createdAt: string;
  lastActivityAt: string;
}

// ---- JSONL persistence ----

const TEAMS_CONFIG_FILE = 'teams-config.jsonl';
const TEAMS_MAPPINGS_FILE = 'teams-mappings.jsonl';
const TEAMS_CONVERSATIONS_FILE = 'teams-conversations.jsonl';

function persistConfigs(store: Map<string, TeamsConfig>): void {
  writeJsonlFile(TEAMS_CONFIG_FILE, Array.from(store.values()));
}

function persistMappings(store: Map<string, TeamsChannelMapping>): void {
  writeJsonlFile(TEAMS_MAPPINGS_FILE, Array.from(store.values()));
}

function persistConversations(store: Map<string, TeamsConversation>): void {
  writeJsonlFile(TEAMS_CONVERSATIONS_FILE, Array.from(store.values()));
}

// ---- Global singleton storage ----

declare global {
  // eslint-disable-next-line no-var
  var __cliaasTeamsConfigs: Map<string, TeamsConfig> | undefined;
  // eslint-disable-next-line no-var
  var __cliaasTeamsConfigsLoaded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __cliaasTeamsMappings: Map<string, TeamsChannelMapping> | undefined;
  // eslint-disable-next-line no-var
  var __cliaasTeamsMappingsLoaded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __cliaasTeamsConvs: Map<string, TeamsConversation> | undefined;
  // eslint-disable-next-line no-var
  var __cliaasTeamsConvsLoaded: boolean | undefined;
}

function getConfigStore(): Map<string, TeamsConfig> {
  if (!global.__cliaasTeamsConfigs) {
    global.__cliaasTeamsConfigs = new Map();
  }
  if (!global.__cliaasTeamsConfigsLoaded) {
    global.__cliaasTeamsConfigsLoaded = true;
    const saved = readJsonlFile<TeamsConfig>(TEAMS_CONFIG_FILE);
    for (const cfg of saved) {
      global.__cliaasTeamsConfigs.set(cfg.id, cfg);
    }
  }
  return global.__cliaasTeamsConfigs;
}

function getMappingStore(): Map<string, TeamsChannelMapping> {
  if (!global.__cliaasTeamsMappings) {
    global.__cliaasTeamsMappings = new Map();
  }
  if (!global.__cliaasTeamsMappingsLoaded) {
    global.__cliaasTeamsMappingsLoaded = true;
    const saved = readJsonlFile<TeamsChannelMapping>(TEAMS_MAPPINGS_FILE);
    for (const m of saved) {
      global.__cliaasTeamsMappings.set(m.id, m);
    }
  }
  return global.__cliaasTeamsMappings;
}

function getConversationStore(): Map<string, TeamsConversation> {
  if (!global.__cliaasTeamsConvs) {
    global.__cliaasTeamsConvs = new Map();
  }
  if (!global.__cliaasTeamsConvsLoaded) {
    global.__cliaasTeamsConvsLoaded = true;
    const saved = readJsonlFile<TeamsConversation>(TEAMS_CONVERSATIONS_FILE);
    for (const c of saved) {
      global.__cliaasTeamsConvs.set(c.id, c);
    }
  }
  return global.__cliaasTeamsConvs;
}

// ---- Config operations ----

export function getTeamsConfig(workspaceId?: string): TeamsConfig | undefined {
  const store = getConfigStore();
  for (const cfg of store.values()) {
    if (!workspaceId || !cfg.workspaceId || cfg.workspaceId === workspaceId) {
      return cfg;
    }
  }
  return undefined;
}

export function saveTeamsConfig(
  config: Omit<TeamsConfig, 'id' | 'createdAt'> & { id?: string },
): TeamsConfig {
  const store = getConfigStore();
  const saved: TeamsConfig = {
    id: config.id ?? `teams-cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: config.workspaceId,
    appId: config.appId,
    appPassword: config.appPassword,
    botName: config.botName,
    createdAt: new Date().toISOString(),
  };
  store.set(saved.id, saved);
  persistConfigs(store);
  logger.info({ configId: saved.id }, 'Teams config saved');
  return saved;
}

// ---- Mapping operations ----

export function getTeamsMappings(workspaceId?: string): TeamsChannelMapping[] {
  const store = getMappingStore();
  let mappings = Array.from(store.values());
  if (workspaceId) {
    mappings = mappings.filter(m => !m.workspaceId || m.workspaceId === workspaceId);
  }
  return mappings;
}

export function createTeamsMapping(
  input: Omit<TeamsChannelMapping, 'id' | 'createdAt'>,
): TeamsChannelMapping {
  const store = getMappingStore();
  const mapping: TeamsChannelMapping = {
    id: `teams-map-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
    createdAt: new Date().toISOString(),
  };
  store.set(mapping.id, mapping);
  persistMappings(store);
  return mapping;
}

// ---- Conversation operations ----

export function findTeamsConversation(teamsConversationId: string): TeamsConversation | undefined {
  const store = getConversationStore();
  for (const conv of store.values()) {
    if (conv.teamsConversationId === teamsConversationId) return conv;
  }
  return undefined;
}

export function createTeamsConversation(
  teamsConversationId: string,
  serviceUrl: string,
  userName?: string,
  tenantId?: string,
): TeamsConversation {
  const store = getConversationStore();
  const now = new Date().toISOString();
  const conv: TeamsConversation = {
    id: `teams-conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    teamsConversationId,
    serviceUrl,
    userName,
    tenantId,
    messages: [],
    createdAt: now,
    lastActivityAt: now,
  };
  store.set(conv.id, conv);
  persistConversations(store);
  return conv;
}

export function addTeamsMessage(
  conversationId: string,
  direction: 'inbound' | 'outbound',
  text: string,
  activityId: string,
): TeamsConversation | null {
  const store = getConversationStore();
  const conv = store.get(conversationId);
  if (!conv) return null;

  const now = new Date().toISOString();
  conv.messages.push({ direction, text, activityId, timestamp: now });
  conv.lastActivityAt = now;
  store.set(conversationId, conv);
  persistConversations(store);
  return conv;
}

export function setTeamsConversationTicketId(conversationId: string, ticketId: string): void {
  const store = getConversationStore();
  const conv = store.get(conversationId);
  if (!conv) return;
  conv.ticketId = ticketId;
  store.set(conversationId, conv);
  persistConversations(store);
}

export function getAllTeamsConversations(): TeamsConversation[] {
  const store = getConversationStore();
  return Array.from(store.values()).sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );
}
