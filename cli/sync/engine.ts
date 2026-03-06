/**
 * Sync Engine — runs a single sync cycle for a connector.
 *
 * Flow:
 *   1. Read cursor from sync_cursors (if DB available) or from manifest.json (JSONL mode)
 *   2. Call connector's export function with cursor state
 *   3. Export writes to outDir (JSONL files)
 *   4. Update sync_cursors with new cursor values
 *   5. Return sync stats
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ExportManifest } from '../schema/types.js';
import { resolveConnectorAuth } from './auth.js';

// Re-export for backwards compatibility
export { resolveConnectorAuth } from './auth.js';

export interface SyncStats {
  connector: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  counts: ExportManifest['counts'];
  cursorState?: Record<string, string>;
  fullSync: boolean;
  error?: string;
}

export interface SyncOptions {
  fullSync?: boolean;
  outDir?: string;
}

/** Supported connectors that have export functions. */
export const CONNECTOR_DEFAULTS: Record<string, { outDir: string }> = {
  zendesk: { outDir: './exports/zendesk' },
  kayako: { outDir: './exports/kayako' },
  'kayako-classic': { outDir: './exports/kayako-classic' },
  helpcrunch: { outDir: './exports/helpcrunch' },
  freshdesk: { outDir: './exports/freshdesk' },
  groove: { outDir: './exports/groove' },
  intercom: { outDir: './exports/intercom' },
  helpscout: { outDir: './exports/helpscout' },
  'zoho-desk': { outDir: './exports/zoho-desk' },
  hubspot: { outDir: './exports/hubspot' },
};

/**
 * Load the previous manifest (with cursor state) from an export directory.
 */
function loadManifest(outDir: string): ExportManifest | null {
  const manifestPath = join(outDir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}


/**
 * Run a single sync cycle for a connector.
 * Supports all 10 connectors. Zendesk uses incremental cursor; others do full re-export.
 */
export async function runSyncCycle(
  connectorName: string,
  opts?: SyncOptions,
): Promise<SyncStats> {
  const startedAt = new Date();
  const defaults = CONNECTOR_DEFAULTS[connectorName];
  if (!defaults) {
    throw new Error(`Unknown connector: ${connectorName}. Supported: ${Object.keys(CONNECTOR_DEFAULTS).join(', ')}`);
  }

  const outDir = opts?.outDir ?? defaults.outDir;
  const fullSync = opts?.fullSync ?? false;

  // Resolve auth from env
  const auth = resolveConnectorAuth(connectorName);
  if (!auth) {
    throw new Error(
      `Missing authentication for ${connectorName}. Set the required environment variables.`,
    );
  }

  // Load existing cursor state (unless fullSync requested)
  let cursorState: Record<string, string> | undefined;
  if (!fullSync) {
    const existing = loadManifest(outDir);
    cursorState = existing?.cursorState ?? undefined;
  }

  let manifest: ExportManifest;

  try {
    switch (connectorName) {
      case 'zendesk': {
        const { exportZendesk } = await import('../connectors/zendesk.js');
        manifest = await exportZendesk(
          auth as { subdomain: string; email: string; token: string },
          outDir,
          cursorState,
        );
        break;
      }
      case 'kayako': {
        const { exportKayako } = await import('../connectors/kayako.js');
        manifest = await exportKayako(
          auth as { domain: string; email: string; password: string },
          outDir,
        );
        break;
      }
      case 'kayako-classic': {
        const { exportKayakoClassic } = await import('../connectors/kayako-classic.js');
        manifest = await exportKayakoClassic(
          auth as { domain: string; apiKey: string; secretKey: string },
          outDir,
        );
        break;
      }
      case 'freshdesk': {
        const { exportFreshdesk } = await import('../connectors/freshdesk.js');
        manifest = await exportFreshdesk(
          { subdomain: auth.domain, apiKey: auth.apiKey },
          outDir,
          cursorState ? { lastSyncAt: cursorState.lastSyncAt } : undefined,
        );
        break;
      }
      case 'helpcrunch': {
        const { exportHelpcrunch } = await import('../connectors/helpcrunch.js');
        manifest = await exportHelpcrunch(
          { apiKey: auth.apiKey },
          outDir,
          cursorState ? { lastSyncAt: cursorState.lastSyncAt } : undefined,
        );
        break;
      }
      case 'groove': {
        const { exportGroove } = await import('../connectors/groove.js');
        manifest = await exportGroove(
          { apiToken: auth.apiKey },
          outDir,
          cursorState ? { lastSyncAt: cursorState.lastSyncAt } : undefined,
        );
        break;
      }
      case 'intercom': {
        const { exportIntercom } = await import('../connectors/intercom.js');
        manifest = await exportIntercom(
          { accessToken: auth.token },
          outDir,
          cursorState ? { lastSyncAt: cursorState.lastSyncAt } : undefined,
        );
        break;
      }
      case 'helpscout': {
        const { exportHelpScout } = await import('../connectors/helpscout.js');
        manifest = await exportHelpScout(
          { appId: auth.appId, appSecret: auth.appSecret },
          outDir,
          cursorState ? { lastSyncAt: cursorState.lastSyncAt } : undefined,
        );
        break;
      }
      case 'zoho-desk': {
        const { exportZohoDesk } = await import('../connectors/zoho-desk.js');
        manifest = await exportZohoDesk(
          { orgId: auth.orgId, accessToken: auth.token, apiDomain: auth.domain },
          outDir,
          cursorState ? { lastSyncAt: cursorState.lastSyncAt } : undefined,
        );
        break;
      }
      case 'hubspot': {
        const { exportHubSpot } = await import('../connectors/hubspot.js');
        manifest = await exportHubSpot(
          { accessToken: auth.token },
          outDir,
        );
        break;
      }
      default: {
        throw new Error(
          `Unknown connector: "${connectorName}". Supported: ${Object.keys(CONNECTOR_DEFAULTS).join(', ')}`,
        );
      }
    }
  } catch (err) {
    const finishedAt = new Date();
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Record sync failure for health monitoring
    void recordSyncHealth(connectorName, {
      success: false,
      error: errorMsg,
      recordsSynced: 0,
    });

    return {
      connector: connectorName,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      counts: { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 },
      fullSync,
      error: errorMsg,
    };
  }

  const finishedAt = new Date();

  // Auto-route newly imported tickets that have no assignee
  if (manifest.counts.tickets > 0) {
    void (async () => {
      try {
        const { routeTicket } = await import('@/lib/routing/engine.js');
        const { availability } = await import('@/lib/routing/availability.js');
        const { getRoutingConfig } = await import('@/lib/routing/store.js');
        const { getDataProvider } = await import('@/lib/data-provider/index.js');

        const config = getRoutingConfig();
        if (!config.enabled || !config.autoRouteOnCreate) return;

        const allAvail = availability.getAllAvailability();
        const allAgents = allAvail.map(a => ({ userId: a.userId, userName: a.userName }));
        if (allAgents.length === 0) return;

        const provider = await getDataProvider(outDir);
        const tickets = await provider.loadTickets();
        const unassigned = tickets.filter(t => !t.assignee);

        for (const ticket of unassigned.slice(0, 50)) {
          await routeTicket(ticket, { allAgents });
        }
      } catch {
        // Routing is best-effort during sync
      }
    })();
  }

  // Record sync success for health monitoring
  const totalRecords = manifest.counts.tickets + manifest.counts.messages
    + manifest.counts.customers + manifest.counts.organizations
    + manifest.counts.kbArticles + manifest.counts.rules;
  void recordSyncHealth(connectorName, {
    success: true,
    recordsSynced: totalRecords,
    cursorState: manifest.cursorState,
  });

  return {
    connector: connectorName,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    counts: manifest.counts,
    cursorState: manifest.cursorState,
    fullSync: !cursorState,
  };
}

/**
 * Get the current sync status for a connector (cursor state + last sync time).
 */
export function getSyncStatus(connectorName?: string): Array<{
  connector: string;
  lastSyncedAt: string | null;
  cursorState: Record<string, string> | null;
  ticketCount: number;
}> {
  const connectors = connectorName
    ? [connectorName]
    : Object.keys(CONNECTOR_DEFAULTS);

  const results: Array<{
    connector: string;
    lastSyncedAt: string | null;
    cursorState: Record<string, string> | null;
    ticketCount: number;
  }> = [];

  for (const name of connectors) {
    const defaults = CONNECTOR_DEFAULTS[name];
    if (!defaults) continue;

    const manifest = loadManifest(defaults.outDir);
    results.push({
      connector: name,
      lastSyncedAt: manifest?.exportedAt ?? null,
      cursorState: manifest?.cursorState ?? null,
      ticketCount: manifest?.counts.tickets ?? 0,
    });
  }

  return results;
}

/**
 * List all supported connector names.
 */
export function listConnectors(): string[] {
  return Object.keys(CONNECTOR_DEFAULTS);
}

/**
 * Best-effort recording of sync health. Falls through silently on failure.
 */
async function recordSyncHealth(
  connector: string,
  result: { success: boolean; error?: string; recordsSynced: number; cursorState?: object },
): Promise<void> {
  try {
    const { recordSyncResult } = await import('@/lib/sync/health-store.js');
    await recordSyncResult('default', connector, result);
  } catch {
    // Health monitoring is best-effort; don't fail the sync
  }
}
