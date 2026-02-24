import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';

export function registerSyncTools(server: McpServer): void {
  server.tool(
    'sync_status',
    'Show sync cursors and last sync time for connectors',
    {
      connector: z.string().optional().describe('Filter by connector name (e.g. zendesk, kayako)'),
    },
    async ({ connector }) => {
      try {
        const { getSyncStatus, listConnectors } = await import('../../sync/engine.js');
        const statuses = getSyncStatus(connector);

        if (statuses.length === 0) {
          return textResult({
            message: 'No sync data found',
            supportedConnectors: listConnectors(),
          });
        }

        return textResult({
          connectors: statuses,
          supportedConnectors: listConnectors(),
        });
      } catch (err) {
        return errorResult(`Failed to get sync status: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'sync_trigger',
    'Trigger an immediate sync cycle for a connector',
    {
      connector: z.string().describe('Connector name (e.g. zendesk, kayako, kayako-classic)'),
      fullSync: z.boolean().optional().describe('Force full sync, ignoring existing cursor'),
    },
    async ({ connector, fullSync }) => {
      try {
        const { runSyncCycle } = await import('../../sync/engine.js');
        const stats = await runSyncCycle(connector, { fullSync });

        if (stats.error) {
          return errorResult(`Sync failed: ${stats.error}`);
        }

        return textResult({
          message: `Sync cycle complete for ${connector}`,
          mode: stats.fullSync ? 'full' : 'incremental',
          durationMs: stats.durationMs,
          counts: stats.counts,
          cursorsUpdated: stats.cursorState ? Object.keys(stats.cursorState).length : 0,
        });
      } catch (err) {
        return errorResult(`Sync trigger failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  // ---- Hybrid sync tools ----

  server.tool(
    'sync_pull',
    'Pull data from hosted API into local DB (hybrid mode)',
    {},
    async () => {
      try {
        const { syncPull } = await import('../../sync/hybrid.js');
        const result = await syncPull();

        return textResult({
          message: 'Pull complete',
          ticketsPulled: result.ticketsPulled,
          articlesPulled: result.articlesPulled,
          conflicts: result.conflicts,
          errors: result.errors.length > 0 ? result.errors : undefined,
        });
      } catch (err) {
        return errorResult(`Pull failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'sync_push',
    'Push pending local changes (outbox) to hosted API (hybrid mode)',
    {},
    async () => {
      try {
        const { syncPush } = await import('../../sync/hybrid.js');
        const result = await syncPush();

        return textResult({
          message: 'Push complete',
          pushed: result.pushed,
          conflicts: result.conflicts,
          failed: result.failed,
          errors: result.errors.length > 0 ? result.errors : undefined,
        });
      } catch (err) {
        return errorResult(`Push failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'sync_conflicts',
    'List unresolved sync conflicts (hybrid mode)',
    {},
    async () => {
      try {
        const { listConflicts } = await import('../../sync/hybrid.js');
        const conflicts = await listConflicts();

        if (conflicts.length === 0) {
          return textResult({ message: 'No unresolved conflicts', conflicts: [] });
        }

        return textResult({
          message: `${conflicts.length} unresolved conflict(s)`,
          conflicts,
        });
      } catch (err) {
        return errorResult(`Failed to list conflicts: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}
