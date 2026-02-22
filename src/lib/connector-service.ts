import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Connector metadata and runtime operations for the web backend.
// Credentials come from process.env (loaded by Next.js from .env).

export type ConnectorId = 'zendesk' | 'helpcrunch' | 'freshdesk' | 'groove';

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

export function getConnectorStatus(id: ConnectorId): ConnectorMeta {
  const defs: Record<ConnectorId, { name: string; envKeys: string[]; exportDir: string }> = {
    zendesk: {
      name: 'Zendesk',
      envKeys: ['ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_TOKEN'],
      exportDir: './exports/zendesk',
    },
    helpcrunch: {
      name: 'HelpCrunch',
      envKeys: ['HELPCRUNCH_API_KEY'],
      exportDir: './exports/helpcrunch',
    },
    freshdesk: {
      name: 'Freshdesk',
      envKeys: ['FRESHDESK_SUBDOMAIN', 'FRESHDESK_API_KEY'],
      exportDir: './exports/freshdesk',
    },
    groove: {
      name: 'Groove',
      envKeys: ['GROOVE_API_TOKEN'],
      exportDir: './exports/groove',
    },
  };

  const def = defs[id];
  const envVars: Record<string, string | undefined> = {};
  for (const key of def.envKeys) {
    envVars[key] = process.env[key];
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
  };
}

export function getAllConnectorStatuses(): ConnectorMeta[] {
  const ids: ConnectorId[] = ['zendesk', 'helpcrunch', 'freshdesk', 'groove'];
  return ids.map(getConnectorStatus);
}

// Resolve the source connector from a ticket ID prefix
export function resolveSource(ticketId: string): ConnectorId | null {
  if (ticketId.startsWith('zd-')) return 'zendesk';
  if (ticketId.startsWith('hc-')) return 'helpcrunch';
  if (ticketId.startsWith('fd-')) return 'freshdesk';
  if (ticketId.startsWith('gv-')) return 'groove';
  return null;
}

// Extract the numeric/external ID from our prefixed ID
export function extractExternalId(ticketId: string): string {
  return ticketId.replace(/^(zd|hc|fd|gv)-/, '');
}
