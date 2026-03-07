import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Re-export from canonical registry
export { resolveSource, extractExternalId } from './connector-registry';
export type { ConnectorId } from './connector-registry';

import { CONNECTOR_REGISTRY, ALL_CONNECTOR_IDS, type ConnectorId } from './connector-registry';

const CAPABILITIES: Record<string, ConnectorCapabilities> = {
  zendesk:           { read: true, incrementalSync: true,  update: true,  reply: true,  note: true,  create: true  },
  freshdesk:         { read: true, incrementalSync: false, update: true,  reply: true,  note: true,  create: true  },
  groove:            { read: true, incrementalSync: false, update: true,  reply: true,  note: true,  create: true  },
  helpcrunch:        { read: true, incrementalSync: false, update: true,  reply: true,  note: true,  create: true  },
  intercom:          { read: true, incrementalSync: true,  update: false, reply: true,  note: true,  create: true  },
  helpscout:         { read: true, incrementalSync: false, update: false, reply: true,  note: true,  create: true  },
  'zoho-desk':       { read: true, incrementalSync: false, update: false, reply: true,  note: true,  create: true  },
  hubspot:           { read: true, incrementalSync: true,  update: true,  reply: true,  note: true,  create: true  },
  kayako:            { read: true, incrementalSync: false, update: true,  reply: true,  note: true,  create: true  },
  'kayako-classic':  { read: true, incrementalSync: false, update: true,  reply: true,  note: true,  create: true  },
};

export interface ConnectorCapabilities {
  read: boolean;
  incrementalSync: boolean;
  update: boolean;
  reply: boolean;
  note: boolean;
  create: boolean;
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
    capabilities: CAPABILITIES[id] ?? { read: true, incrementalSync: false, update: false, reply: false, note: false, create: false },
  };
}

export function getAllConnectorStatuses(): ConnectorMeta[] {
  return ALL_CONNECTOR_IDS.map(getConnectorStatus);
}
