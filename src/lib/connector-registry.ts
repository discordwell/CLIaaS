/**
 * Single source of truth for all connector metadata.
 * Merges fields previously split across connector-service.ts, connector-auth.ts, and connectors.ts.
 */

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

export type ConnectorDirection = 'import' | 'export' | 'bidirectional';
export type ConnectorStatus = 'planned' | 'building' | 'ready';

export interface ConnectorDef {
  id: ConnectorId;
  name: string;
  prefix: string;          // ticket ID prefix (e.g. 'zd-')
  envKeys: string[];
  exportDir: string;
  direction: ConnectorDirection;
  status: ConnectorStatus;
  formats: string[];
  cliExample: string;
}

export const CONNECTOR_REGISTRY: Record<ConnectorId, ConnectorDef> = {
  zendesk: {
    id: 'zendesk',
    name: 'Zendesk',
    prefix: 'zd-',
    envKeys: ['ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_TOKEN'],
    exportDir: './exports/zendesk',
    direction: 'bidirectional',
    status: 'ready',
    formats: ['jsonl', 'json'],
    cliExample: 'cliaas zendesk export --subdomain acme --email agent@acme.com --token <key> --out ./exports/zendesk',
  },
  helpcrunch: {
    id: 'helpcrunch',
    name: 'HelpCrunch',
    prefix: 'hc-',
    envKeys: ['HELPCRUNCH_API_KEY'],
    exportDir: './exports/helpcrunch',
    direction: 'bidirectional',
    status: 'ready',
    formats: ['jsonl', 'json'],
    cliExample: 'cliaas helpcrunch export --api-key <key> --out ./exports/helpcrunch',
  },
  freshdesk: {
    id: 'freshdesk',
    name: 'Freshdesk',
    prefix: 'fd-',
    envKeys: ['FRESHDESK_SUBDOMAIN', 'FRESHDESK_API_KEY'],
    exportDir: './exports/freshdesk',
    direction: 'bidirectional',
    status: 'ready',
    formats: ['jsonl', 'json'],
    cliExample: 'cliaas freshdesk export --subdomain acme --api-key <key> --out ./exports/freshdesk',
  },
  groove: {
    id: 'groove',
    name: 'Groove',
    prefix: 'gv-',
    envKeys: ['GROOVE_API_TOKEN'],
    exportDir: './exports/groove',
    direction: 'bidirectional',
    status: 'ready',
    formats: ['jsonl', 'json'],
    cliExample: 'cliaas groove export --api-token <token> --out ./exports/groove',
  },
  intercom: {
    id: 'intercom',
    name: 'Intercom',
    prefix: 'ic-',
    envKeys: ['INTERCOM_ACCESS_TOKEN'],
    exportDir: './exports/intercom',
    direction: 'bidirectional',
    status: 'ready',
    formats: ['jsonl', 'json'],
    cliExample: 'cliaas intercom export --access-token <token> --out ./exports/intercom',
  },
  helpscout: {
    id: 'helpscout',
    name: 'Help Scout',
    prefix: 'hs-',
    envKeys: ['HELPSCOUT_APP_ID', 'HELPSCOUT_APP_SECRET'],
    exportDir: './exports/helpscout',
    direction: 'bidirectional',
    status: 'ready',
    formats: ['jsonl', 'json'],
    cliExample: 'cliaas helpscout export --app-id <id> --app-secret <secret> --out ./exports/helpscout',
  },
  hubspot: {
    id: 'hubspot',
    name: 'HubSpot',
    prefix: 'hb-',
    envKeys: ['HUBSPOT_ACCESS_TOKEN'],
    exportDir: './exports/hubspot',
    direction: 'bidirectional',
    status: 'ready',
    formats: ['jsonl', 'json'],
    cliExample: 'cliaas hubspot export --access-token <token> --out ./exports/hubspot',
  },
  'zoho-desk': {
    id: 'zoho-desk',
    name: 'Zoho Desk',
    prefix: 'zd2-',
    envKeys: ['ZOHO_DESK_ORG_ID', 'ZOHO_DESK_ACCESS_TOKEN'],
    exportDir: './exports/zoho-desk',
    direction: 'bidirectional',
    status: 'ready',
    formats: ['jsonl', 'json'],
    cliExample: 'cliaas zoho-desk export --org-id <id> --access-token <token> --out ./exports/zoho-desk',
  },
  kayako: {
    id: 'kayako',
    name: 'Kayako',
    prefix: 'ky-',
    envKeys: ['KAYAKO_DOMAIN', 'KAYAKO_EMAIL', 'KAYAKO_PASSWORD'],
    exportDir: './exports/kayako',
    direction: 'bidirectional',
    status: 'ready',
    formats: ['jsonl', 'json'],
    cliExample: 'cliaas kayako export --domain acme.kayako.com --email admin@acme.com --password <pass> --out ./exports/kayako',
  },
  'kayako-classic': {
    id: 'kayako-classic',
    name: 'Kayako Classic',
    prefix: 'kyc-',
    envKeys: ['KAYAKO_CLASSIC_DOMAIN', 'KAYAKO_CLASSIC_API_KEY', 'KAYAKO_CLASSIC_SECRET_KEY'],
    exportDir: './exports/kayako-classic',
    direction: 'bidirectional',
    status: 'ready',
    formats: ['jsonl', 'json'],
    cliExample: 'cliaas kayako-classic export --domain acme.kayako.com --api-key <key> --secret-key <secret> --out ./exports/kayako-classic',
  },
};

export const ALL_CONNECTOR_IDS = Object.keys(CONNECTOR_REGISTRY) as ConnectorId[];

// Sorted longest prefix first to avoid false matches (zd2- before zd-, kyc- before ky-)
const PREFIXES_SORTED = ALL_CONNECTOR_IDS
  .map(id => ({ id, prefix: CONNECTOR_REGISTRY[id].prefix }))
  .sort((a, b) => b.prefix.length - a.prefix.length);

export function resolveSource(ticketId: string): ConnectorId | null {
  for (const { id, prefix } of PREFIXES_SORTED) {
    if (ticketId.startsWith(prefix)) return id;
  }
  return null;
}

const PREFIX_REGEX = new RegExp(
  `^(${PREFIXES_SORTED.map(p => p.prefix.replace('-', '\\-')).join('|')})`,
);

export function extractExternalId(ticketId: string): string {
  return ticketId.replace(PREFIX_REGEX, '');
}
