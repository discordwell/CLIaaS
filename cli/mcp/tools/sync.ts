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
}
