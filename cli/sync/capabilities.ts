/**
 * Static capability matrix for all connectors.
 * Describes what write operations each connector supports.
 */

export interface ConnectorCapability {
  read: boolean;
  incrementalSync: boolean;
  update: boolean;
  reply: boolean;
  note: boolean;
  create: boolean;
}

export const CONNECTOR_CAPABILITIES: Record<string, ConnectorCapability> = {
  zendesk:           { read: true, incrementalSync: true,  update: true,  reply: true,  note: true,  create: true  },
  freshdesk:         { read: true, incrementalSync: false, update: true,  reply: true,  note: true,  create: true  },
  groove:            { read: true, incrementalSync: false, update: true,  reply: true,  note: true,  create: true  },
  helpcrunch:        { read: true, incrementalSync: false, update: true,  reply: true,  note: true,  create: true  },
  intercom:          { read: true, incrementalSync: false, update: false, reply: true,  note: true,  create: true  },
  helpscout:         { read: true, incrementalSync: false, update: false, reply: true,  note: true,  create: true  },
  'zoho-desk':       { read: true, incrementalSync: false, update: false, reply: true,  note: true,  create: true  },
  hubspot:           { read: true, incrementalSync: false, update: true,  reply: true,  note: true,  create: true  },
  kayako:            { read: true, incrementalSync: false, update: true,  reply: true,  note: true,  create: true  },
  'kayako-classic':  { read: true, incrementalSync: false, update: true,  reply: true,  note: true,  create: true  },
};

export function getCapabilities(connector: string): ConnectorCapability | null {
  return CONNECTOR_CAPABILITIES[connector] ?? null;
}

export function getAllCapabilities(): Record<string, ConnectorCapability> {
  return Object.fromEntries(
    Object.entries(CONNECTOR_CAPABILITIES).map(([k, v]) => [k, { ...v }]),
  );
}

export type SyncTier = 'full sync' | 'read + write' | 'read only';

export function getSyncTier(cap: ConnectorCapability): SyncTier {
  if (cap.update && cap.reply && cap.note && cap.create) return 'full sync';
  if (cap.update || cap.reply || cap.note || cap.create) return 'read + write';
  return 'read only';
}
