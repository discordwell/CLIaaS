/**
 * Sync Pull Orchestrator — chains export → ingest in a single call.
 *
 * Reused by CLI, MCP, and API surfaces so the "sync + ingest" behaviour
 * lives in exactly one place.
 */

import { runSyncCycle, CONNECTOR_DEFAULTS, type SyncStats, type SyncOptions } from './engine.js';

export interface PullOptions extends SyncOptions {
  /** When true, ingest exported JSONL into Postgres after export. */
  ingest?: boolean;
  tenant?: string;
  workspace?: string;
}

export interface PullResult extends SyncStats {
  ingested: boolean;
  ingestSkipped: boolean;
  ingestError?: string;
}

/**
 * Run a sync cycle and optionally ingest the result into Postgres.
 */
export async function syncAndIngest(
  connectorName: string,
  opts?: PullOptions,
): Promise<PullResult> {
  const stats = await runSyncCycle(connectorName, opts);

  const base: PullResult = {
    ...stats,
    ingested: false,
    ingestSkipped: false,
  };

  // If export errored or ingest not requested, return early
  if (stats.error || !opts?.ingest) {
    return base;
  }

  // Check DB availability (lazy import to avoid pulling in DB deps when not needed)
  let dbAvailable: boolean;
  try {
    const { isDatabaseAvailable } = await import('../../src/db/index.js');
    dbAvailable = isDatabaseAvailable();
  } catch {
    dbAvailable = false;
  }

  if (!dbAvailable) {
    return { ...base, ingestSkipped: true };
  }

  // Resolve the export directory that was used
  const defaults = CONNECTOR_DEFAULTS[connectorName];
  const outDir = opts?.outDir ?? defaults?.outDir ?? `./exports/${connectorName}`;

  const tenant = opts?.tenant ?? process.env.CLIAAS_TENANT ?? 'default';
  const workspace = opts?.workspace ?? process.env.CLIAAS_WORKSPACE ?? 'default';

  try {
    const { ingestZendeskExportDir } = await import('../../src/lib/zendesk/ingest.js');
    await ingestZendeskExportDir({
      dir: outDir,
      tenant,
      workspace,
      provider: connectorName as Parameters<typeof ingestZendeskExportDir>[0]['provider'],
    });
    return { ...base, ingested: true };
  } catch (err) {
    return {
      ...base,
      ingestError: err instanceof Error ? err.message : String(err),
    };
  }
}
