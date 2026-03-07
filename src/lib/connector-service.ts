import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Re-export from canonical registry
export { resolveSource, extractExternalId } from './connector-registry';
export type { ConnectorId } from './connector-registry';

import { CONNECTOR_REGISTRY, ALL_CONNECTOR_IDS, type ConnectorId } from './connector-registry';
import { readJsonlFile, writeJsonlFile } from './jsonl-store';

const CAPABILITIES: Record<string, ConnectorCapabilities> = {
  zendesk:           { read: true, incrementalSync: true,  webhookSync: true,  update: true,  reply: true,  note: true,  create: true  },
  freshdesk:         { read: true, incrementalSync: false, webhookSync: true,  update: true,  reply: true,  note: true,  create: true  },
  groove:            { read: true, incrementalSync: false, webhookSync: false, update: true,  reply: true,  note: true,  create: true  },
  helpcrunch:        { read: true, incrementalSync: false, webhookSync: false, update: true,  reply: true,  note: true,  create: true  },
  intercom:          { read: true, incrementalSync: true,  webhookSync: true,  update: false, reply: true,  note: true,  create: true  },
  helpscout:         { read: true, incrementalSync: false, webhookSync: false, update: false, reply: true,  note: true,  create: true  },
  'zoho-desk':       { read: true, incrementalSync: false, webhookSync: false, update: false, reply: true,  note: true,  create: true  },
  hubspot:           { read: true, incrementalSync: true,  webhookSync: true,  update: true,  reply: true,  note: true,  create: true  },
  kayako:            { read: true, incrementalSync: false, webhookSync: false, update: true,  reply: true,  note: true,  create: true  },
  'kayako-classic':  { read: true, incrementalSync: false, webhookSync: false, update: true,  reply: true,  note: true,  create: true  },
};

export interface ConnectorCapabilities {
  read: boolean;
  incrementalSync: boolean;
  webhookSync: boolean;
  update: boolean;
  reply: boolean;
  note: boolean;
  create: boolean;
}

export interface EntityCapabilities {
  tickets:       { read: boolean; create: boolean; update: boolean; delete: boolean };
  messages:      { read: boolean; create: boolean };
  customers:     { read: boolean; create: boolean; update: boolean };
  organizations: { read: boolean };
  kbArticles:    { read: boolean };
  rules:         { read: boolean };
  conversations: { read: boolean };
}

const ENTITY_CAPABILITIES: Record<ConnectorId, EntityCapabilities> = {
  zendesk: {
    tickets:       { read: true,  create: true,  update: true,  delete: true  },
    messages:      { read: true,  create: true  },
    customers:     { read: true,  create: true,  update: true  },
    organizations: { read: true  },
    kbArticles:    { read: true  },
    rules:         { read: true  },
    conversations: { read: false },
  },
  freshdesk: {
    tickets:       { read: true,  create: true,  update: true,  delete: true  },
    messages:      { read: true,  create: true  },
    customers:     { read: true,  create: true,  update: true  },
    organizations: { read: false },
    kbArticles:    { read: true  },
    rules:         { read: true  },
    conversations: { read: false },
  },
  intercom: {
    tickets:       { read: true,  create: true,  update: false, delete: false },
    messages:      { read: true,  create: true  },
    customers:     { read: true,  create: true,  update: true  },
    organizations: { read: false },
    kbArticles:    { read: true  },
    rules:         { read: false },
    conversations: { read: true  },
  },
  hubspot: {
    tickets:       { read: true,  create: true,  update: true,  delete: true  },
    messages:      { read: true,  create: true  },
    customers:     { read: true,  create: true,  update: true  },
    organizations: { read: true  },
    kbArticles:    { read: true  },
    rules:         { read: false },
    conversations: { read: true  },
  },
  groove: {
    tickets:       { read: true,  create: true,  update: true,  delete: false },
    messages:      { read: true,  create: true  },
    customers:     { read: true,  create: true,  update: true  },
    organizations: { read: false },
    kbArticles:    { read: true  },
    rules:         { read: false },
    conversations: { read: false },
  },
  helpcrunch: {
    tickets:       { read: true,  create: true,  update: true,  delete: false },
    messages:      { read: true,  create: true  },
    customers:     { read: true,  create: true,  update: true  },
    organizations: { read: false },
    kbArticles:    { read: true  },
    rules:         { read: false },
    conversations: { read: true  },
  },
  helpscout: {
    tickets:       { read: true,  create: true,  update: true,  delete: false },
    messages:      { read: true,  create: true  },
    customers:     { read: true,  create: true,  update: true  },
    organizations: { read: false },
    kbArticles:    { read: true  },
    rules:         { read: false },
    conversations: { read: true  },
  },
  'zoho-desk': {
    tickets:       { read: true,  create: true,  update: true,  delete: true  },
    messages:      { read: true,  create: true  },
    customers:     { read: true,  create: true,  update: true  },
    organizations: { read: true  },
    kbArticles:    { read: true  },
    rules:         { read: true  },
    conversations: { read: false },
  },
  kayako: {
    tickets:       { read: true,  create: true,  update: true,  delete: false },
    messages:      { read: true,  create: true  },
    customers:     { read: true,  create: true,  update: true  },
    organizations: { read: true  },
    kbArticles:    { read: true  },
    rules:         { read: false },
    conversations: { read: true  },
  },
  'kayako-classic': {
    tickets:       { read: true,  create: true,  update: true,  delete: false },
    messages:      { read: true,  create: true  },
    customers:     { read: true,  create: true,  update: true  },
    organizations: { read: true  },
    kbArticles:    { read: true  },
    rules:         { read: false },
    conversations: { read: false },
  },
};

/**
 * Returns entity-level capabilities for a given connector.
 */
export function getEntityCapabilities(connectorId: ConnectorId): EntityCapabilities {
  return ENTITY_CAPABILITIES[connectorId];
}

/**
 * Returns entity-level capabilities for all connectors.
 */
export function getAllEntityCapabilities(): Record<ConnectorId, EntityCapabilities> {
  return { ...ENTITY_CAPABILITIES };
}

export interface ConnectorSyncConfig {
  connectorId: string;
  syncMode: 'webhook' | 'polling' | 'hybrid';
  pollingIntervalMs?: number;     // default 300000 (5 min)
  webhookVerified?: boolean;      // true once a valid webhook payload received
  lastWebhookAt?: string;         // ISO timestamp
  lastPollAt?: string;            // ISO timestamp
  fallbackToPolling?: boolean;    // auto-fallback if webhook silent >15min
}

export interface ConnectorMeta {
  id: ConnectorId;
  name: string;
  envVars: Record<string, string | undefined>;
  configured: boolean;
  hasExport: boolean;
  exportDir: string;
  ticketCount: number;
  messageCount: number;
  customerCount: number;
  kbArticleCount: number;
  lastExport: string | null;
  capabilities: ConnectorCapabilities;
  syncConfig: ConnectorSyncConfig;
}

interface ManifestCounts {
  tickets: number;
  messages: number;
  customers: number;
  organizations: number;
  kbArticles: number;
  rules: number;
}

interface Manifest {
  source: string;
  exportedAt: string;
  counts: ManifestCounts;
}

function readManifest(dir: string): Manifest | null {
  const path = join(dir, 'manifest.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function isSet(val: string | undefined): boolean {
  return !!val && val.length > 0;
}

// ---- Sync config JSONL store ----

const SYNC_CONFIG_FILE = 'connector-sync-configs.jsonl';

const DEFAULT_POLLING_INTERVAL_MS = 300_000; // 5 minutes
const WEBHOOK_SILENCE_THRESHOLD_MS = 900_000; // 15 minutes

/**
 * Returns 'webhook' for connectors that support webhook sync, 'polling' for others.
 */
export function getDefaultSyncMode(connectorId: string): 'webhook' | 'polling' {
  const caps = CAPABILITIES[connectorId];
  return caps?.webhookSync ? 'webhook' : 'polling';
}

function loadAllSyncConfigs(): ConnectorSyncConfig[] {
  return readJsonlFile<ConnectorSyncConfig>(SYNC_CONFIG_FILE);
}

function saveAllSyncConfigs(configs: ConnectorSyncConfig[]): void {
  writeJsonlFile(SYNC_CONFIG_FILE, configs);
}

function buildDefaultSyncConfig(connectorId: string): ConnectorSyncConfig {
  const syncMode = getDefaultSyncMode(connectorId);
  return {
    connectorId,
    syncMode,
    pollingIntervalMs: DEFAULT_POLLING_INTERVAL_MS,
    webhookVerified: false,
    fallbackToPolling: syncMode === 'webhook', // auto-fallback enabled for webhook-primary connectors
  };
}

/**
 * Get the sync config for a connector. Returns the persisted config or a default.
 */
export function getSyncConfig(connectorId: string): ConnectorSyncConfig {
  const all = loadAllSyncConfigs();
  const existing = all.find(c => c.connectorId === connectorId);
  if (existing) return existing;
  return buildDefaultSyncConfig(connectorId);
}

/**
 * Update (merge) the sync config for a connector and persist.
 * Creates the config entry if it doesn't exist yet.
 */
export function updateSyncConfig(
  connectorId: string,
  updates: Partial<ConnectorSyncConfig>,
): ConnectorSyncConfig {
  const all = loadAllSyncConfigs();
  const idx = all.findIndex(c => c.connectorId === connectorId);
  const base = idx >= 0 ? all[idx] : buildDefaultSyncConfig(connectorId);
  const merged: ConnectorSyncConfig = { ...base, ...updates, connectorId }; // connectorId is immutable

  if (idx >= 0) {
    all[idx] = merged;
  } else {
    all.push(merged);
  }
  saveAllSyncConfigs(all);
  return merged;
}

/**
 * Check whether a webhook-primary connector should fall back to polling.
 * Returns true if fallbackToPolling is enabled and the webhook has been silent
 * for longer than the threshold (15 minutes), or if webhookVerified is false.
 */
export function shouldFallbackToPolling(config: ConnectorSyncConfig): boolean {
  if (config.syncMode !== 'webhook' && config.syncMode !== 'hybrid') return false;
  if (!config.fallbackToPolling) return false;
  if (!config.webhookVerified) return true;
  if (!config.lastWebhookAt) return true;

  const elapsed = Date.now() - new Date(config.lastWebhookAt).getTime();
  return elapsed > WEBHOOK_SILENCE_THRESHOLD_MS;
}

export function getConnectorStatus(id: ConnectorId): ConnectorMeta {
  const def = CONNECTOR_REGISTRY[id];
  const envVars: Record<string, string | undefined> = {};
  for (const key of def.envKeys) {
    envVars[key] = isSet(process.env[key]) ? '••••••••' : undefined;
  }
  const configured = def.envKeys.every(k => isSet(process.env[k]));
  const manifest = readManifest(def.exportDir);

  return {
    id,
    name: def.name,
    envVars,
    configured,
    hasExport: manifest !== null,
    exportDir: def.exportDir,
    ticketCount: manifest?.counts.tickets ?? 0,
    messageCount: manifest?.counts.messages ?? 0,
    customerCount: manifest?.counts.customers ?? 0,
    kbArticleCount: manifest?.counts.kbArticles ?? 0,
    lastExport: manifest?.exportedAt ?? null,
    capabilities: CAPABILITIES[id] ?? { read: true, incrementalSync: false, webhookSync: false, update: false, reply: false, note: false, create: false },
    syncConfig: getSyncConfig(id),
  };
}

export function getAllConnectorStatuses(): ConnectorMeta[] {
  return ALL_CONNECTOR_IDS.map(getConnectorStatus);
}
