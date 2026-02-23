import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Connector metadata and runtime operations for the web backend.
// Credentials come from process.env (loaded by Next.js from .env).

export type ConnectorId =
  | 'zendesk'
  | 'helpcrunch'
  | 'freshdesk'
  | 'groove'
  | 'intercom'
  | 'helpscout'
  | 'hubspot'
  | 'zoho-desk'
  | 'kayako'
  | 'kayako-classic';

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

const CONNECTOR_DEFS: Record<ConnectorId, { name: string; envKeys: string[]; exportDir: string }> = {
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
  intercom: {
    name: 'Intercom',
    envKeys: ['INTERCOM_ACCESS_TOKEN'],
    exportDir: './exports/intercom',
  },
  helpscout: {
    name: 'Help Scout',
    envKeys: ['HELPSCOUT_APP_ID', 'HELPSCOUT_APP_SECRET'],
    exportDir: './exports/helpscout',
  },
  hubspot: {
    name: 'HubSpot',
    envKeys: ['HUBSPOT_ACCESS_TOKEN'],
    exportDir: './exports/hubspot',
  },
  'zoho-desk': {
    name: 'Zoho Desk',
    envKeys: ['ZOHO_DESK_ORG_ID', 'ZOHO_DESK_ACCESS_TOKEN'],
    exportDir: './exports/zoho-desk',
  },
  kayako: {
    name: 'Kayako',
    envKeys: ['KAYAKO_DOMAIN', 'KAYAKO_EMAIL', 'KAYAKO_PASSWORD'],
    exportDir: './exports/kayako',
  },
  'kayako-classic': {
    name: 'Kayako Classic',
    envKeys: ['KAYAKO_CLASSIC_DOMAIN', 'KAYAKO_CLASSIC_API_KEY', 'KAYAKO_CLASSIC_SECRET_KEY'],
    exportDir: './exports/kayako-classic',
  },
};

export function getConnectorStatus(id: ConnectorId): ConnectorMeta {
  const def = CONNECTOR_DEFS[id];
  const envVars: Record<string, string | undefined> = {};
  for (const key of def.envKeys) {
    // Only expose whether the var is set, never the raw value
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
  };
}

const ALL_IDS: ConnectorId[] = [
  'zendesk', 'helpcrunch', 'freshdesk', 'groove',
  'intercom', 'helpscout', 'hubspot', 'zoho-desk',
  'kayako', 'kayako-classic',
];

export function getAllConnectorStatuses(): ConnectorMeta[] {
  return ALL_IDS.map(getConnectorStatus);
}

// Resolve the source connector from a ticket ID prefix
// Longer prefixes checked first to avoid false matches (zd2- before zd-, kyc- before ky-)
export function resolveSource(ticketId: string): ConnectorId | null {
  if (ticketId.startsWith('zd2-')) return 'zoho-desk';
  if (ticketId.startsWith('zd-')) return 'zendesk';
  if (ticketId.startsWith('hc-')) return 'helpcrunch';
  if (ticketId.startsWith('fd-')) return 'freshdesk';
  if (ticketId.startsWith('gv-')) return 'groove';
  if (ticketId.startsWith('ic-')) return 'intercom';
  if (ticketId.startsWith('hs-')) return 'helpscout';
  if (ticketId.startsWith('hb-')) return 'hubspot';
  if (ticketId.startsWith('kyc-')) return 'kayako-classic';
  if (ticketId.startsWith('ky-')) return 'kayako';
  return null;
}

// Extract the numeric/external ID from our prefixed ID
export function extractExternalId(ticketId: string): string {
  return ticketId.replace(/^(zd2|zd|hc|fd|gv|ic|hs|hb|kyc|ky)-/, '');
}
