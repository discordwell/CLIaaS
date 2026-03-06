/**
 * Plugin executor — replaces in-memory singleton with store-backed, sandboxed execution.
 */

import { createLogger } from '../logger';
import { getEnabledInstallationsForHook } from './store';
import { getListing } from './marketplace-store';
import { logExecution } from './execution-log';
import { executeSandboxed, executeWebhook } from './sandbox';
import { createPluginSDK } from './sdk-context';
import type { PluginHookContext, PluginHandlerResult, PluginManifestV2 } from './types';

const logger = createLogger('plugins:executor');

/**
 * Execute all enabled plugin hooks for a given event.
 * Maintains the same fire-and-forget, error-isolated pattern as the original.
 */
export async function executePluginHook(
  hookName: string,
  context: PluginHookContext,
): Promise<void> {
  const workspaceId = context.workspaceId;

  let installations;
  try {
    installations = await getEnabledInstallationsForHook(hookName, workspaceId);
  } catch (err) {
    logger.error({ hookName, error: err instanceof Error ? err.message : 'Unknown' }, 'Failed to fetch plugin installations');
    return;
  }

  if (installations.length === 0) return;

  const results = await Promise.allSettled(
    installations.map(async (installation) => {
      const start = Date.now();
      let result: PluginHandlerResult;

      try {
        // Look up manifest for runtime info
        const listing = await getListing(installation.pluginId);
        const manifest = listing?.manifest;

        if (!manifest) {
          result = { ok: false, error: 'Plugin manifest not found' };
        } else if (manifest.runtime === 'webhook' && manifest.webhookUrl) {
          // Webhook execution
          result = await executeWebhook(
            manifest.webhookUrl,
            { ...context, pluginId: installation.pluginId, config: installation.config },
            installation.config._webhookSecret as string ?? installation.pluginId,
          );
        } else if (manifest.runtime === 'node' && manifest.entrypoint) {
          // Sandboxed execution
          const sdk = createPluginSDK(
            manifest.permissions,
            installation.config,
            installation.workspaceId,
          );
          result = await executeSandboxed(
            manifest.entrypoint,
            { ...context, pluginId: installation.pluginId, config: installation.config },
            sdk as unknown as Record<string, unknown>,
          );
        } else {
          // No-op for plugins without runtime (e.g. first-party with registered handlers)
          result = { ok: true };
        }
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : 'Unknown execution error' };
      }

      const durationMs = Date.now() - start;

      // Log execution (fire-and-forget)
      void logExecution({
        installationId: installation.id,
        workspaceId: installation.workspaceId,
        hookName,
        status: result.ok ? 'success' : 'error',
        durationMs,
        input: { event: context.event },
        output: result.data,
        error: result.error,
      }).catch(logErr => {
        logger.error({ pluginId: installation.pluginId, error: logErr instanceof Error ? logErr.message : 'Unknown' }, 'Failed to log plugin execution');
      });

      if (!result.ok) {
        logger.error({
          pluginId: installation.pluginId,
          hookName,
          error: result.error,
        }, 'Plugin hook failed');
      }

      return result;
    }),
  );

  const failures = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok));
  if (failures.length > 0) {
    logger.warn({ hookName, total: installations.length, failed: failures.length }, 'Some plugin hooks failed');
  }
}
