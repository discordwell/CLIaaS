/**
 * MCP plugin tools: plugin_list, plugin_install, plugin_uninstall, plugin_toggle,
 * plugin_config, plugin_logs, marketplace_search, marketplace_show.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { scopeGuard } from './scopes.js';
import {
  getInstallations,
  getInstallationByPluginId,
  installPlugin,
  uninstallPlugin,
  togglePlugin,
  updateInstallation,
} from '@/lib/plugins/store.js';
import { getListings, getListing } from '@/lib/plugins/marketplace-store.js';
import { getExecutionLogs } from '@/lib/plugins/execution-log.js';

export function registerPluginTools(server: McpServer): void {
  // ---- plugin_list ----
  server.tool(
    'plugin_list',
    'List installed plugins',
    {
      enabled: z.boolean().optional().describe('Filter to only enabled plugins'),
    },
    async ({ enabled }) => {
      try {
        let list = await getInstallations();
        if (enabled !== undefined) {
          list = list.filter(p => p.enabled === enabled);
        }
        return textResult({
          count: list.length,
          plugins: list.map(p => ({
            id: p.id,
            pluginId: p.pluginId,
            version: p.version,
            enabled: p.enabled,
            createdAt: p.createdAt,
          })),
        });
      } catch (err) {
        return errorResult(`Failed to list plugins: ${err}`);
      }
    },
  );

  // ---- plugin_install ----
  server.tool(
    'plugin_install',
    'Install a plugin from the marketplace',
    {
      pluginId: z.string().describe('Plugin slug to install'),
      config: z.string().optional().describe('JSON config string'),
    },
    async ({ pluginId, config }) => {
      const blocked = scopeGuard('plugin_install');
      if (blocked) return blocked;

      try {
        const listing = await getListing(pluginId);
        if (!listing) return errorResult(`Plugin "${pluginId}" not found in marketplace`);

        let parsedConfig = {};
        if (config) {
          try {
            parsedConfig = JSON.parse(config);
          } catch {
            return errorResult(`Invalid JSON in config parameter: ${config.slice(0, 100)}`);
          }
        }
        const installation = await installPlugin({
          pluginId,
          version: listing.manifest.version,
          config: parsedConfig,
          hooks: listing.manifest.hooks,
        });

        return textResult({
          message: `Plugin "${pluginId}" installed`,
          id: installation.id,
          version: installation.version,
        });
      } catch (err) {
        return errorResult(`Failed to install plugin: ${err}`);
      }
    },
  );

  // ---- plugin_uninstall ----
  server.tool(
    'plugin_uninstall',
    'Uninstall a plugin',
    {
      pluginId: z.string().describe('Plugin slug to uninstall'),
    },
    async ({ pluginId }) => {
      const blocked = scopeGuard('plugin_uninstall');
      if (blocked) return blocked;

      try {
        const installation = await getInstallationByPluginId(pluginId);
        if (!installation) return errorResult(`Plugin "${pluginId}" is not installed`);

        await uninstallPlugin(installation.id);
        return textResult({ message: `Plugin "${pluginId}" uninstalled` });
      } catch (err) {
        return errorResult(`Failed to uninstall plugin: ${err}`);
      }
    },
  );

  // ---- plugin_toggle ----
  server.tool(
    'plugin_toggle',
    'Enable or disable an installed plugin',
    {
      pluginId: z.string().describe('Plugin slug'),
      enabled: z.boolean().describe('true to enable, false to disable'),
    },
    async ({ pluginId, enabled }) => {
      const blocked = scopeGuard('plugin_toggle');
      if (blocked) return blocked;

      try {
        const installation = await getInstallationByPluginId(pluginId);
        if (!installation) return errorResult(`Plugin "${pluginId}" is not installed`);

        await togglePlugin(installation.id, enabled);
        return textResult({
          message: `Plugin "${pluginId}" ${enabled ? 'enabled' : 'disabled'}`,
          pluginId,
          enabled,
        });
      } catch (err) {
        return errorResult(`Failed to toggle plugin: ${err}`);
      }
    },
  );

  // ---- plugin_config ----
  server.tool(
    'plugin_config',
    'View or update plugin configuration',
    {
      pluginId: z.string().describe('Plugin slug'),
      config: z.string().optional().describe('JSON config to merge (omit to view current config)'),
    },
    async ({ pluginId, config }) => {
      const blocked = scopeGuard('plugin_config');
      if (blocked) return blocked;

      try {
        const installation = await getInstallationByPluginId(pluginId);
        if (!installation) return errorResult(`Plugin "${pluginId}" is not installed`);

        if (!config) {
          return textResult({ pluginId, config: installation.config });
        }

        let configUpdate: Record<string, unknown>;
        try {
          configUpdate = JSON.parse(config);
        } catch {
          return errorResult(`Invalid JSON in config parameter: ${config.slice(0, 100)}`);
        }
        const newConfig = { ...installation.config, ...configUpdate };
        await updateInstallation(installation.id, { config: newConfig });
        return textResult({ message: `Config updated for "${pluginId}"`, config: newConfig });
      } catch (err) {
        return errorResult(`Failed to manage config: ${err}`);
      }
    },
  );

  // ---- plugin_logs ----
  server.tool(
    'plugin_logs',
    'View execution logs for an installed plugin',
    {
      pluginId: z.string().describe('Plugin slug'),
      limit: z.number().optional().describe('Number of log entries (default 20)'),
    },
    async ({ pluginId, limit }) => {
      try {
        const installation = await getInstallationByPluginId(pluginId);
        if (!installation) return errorResult(`Plugin "${pluginId}" is not installed`);

        const logs = await getExecutionLogs(installation.id, { limit: limit ?? 20 });
        return textResult({
          count: logs.length,
          logs: logs.map(l => ({
            hookName: l.hookName,
            status: l.status,
            durationMs: l.durationMs,
            error: l.error,
            createdAt: l.createdAt,
          })),
        });
      } catch (err) {
        return errorResult(`Failed to get logs: ${err}`);
      }
    },
  );

  // ---- marketplace_search ----
  server.tool(
    'marketplace_search',
    'Browse the plugin marketplace',
    {
      query: z.string().optional().describe('Search term'),
      category: z.string().optional().describe('Filter by category'),
    },
    async ({ query, category }) => {
      try {
        const listings = await getListings({ search: query, category });
        return textResult({
          count: listings.length,
          listings: listings.map(l => ({
            pluginId: l.pluginId,
            name: l.manifest.name,
            version: l.manifest.version,
            author: l.manifest.author,
            description: l.manifest.description,
            installCount: l.installCount,
            averageRating: l.averageRating,
            featured: l.featured,
          })),
        });
      } catch (err) {
        return errorResult(`Failed to search marketplace: ${err}`);
      }
    },
  );

  // ---- marketplace_show ----
  server.tool(
    'marketplace_show',
    'Get details for a marketplace plugin',
    {
      pluginId: z.string().describe('Plugin slug'),
    },
    async ({ pluginId }) => {
      try {
        const listing = await getListing(pluginId);
        if (!listing) return errorResult(`Plugin "${pluginId}" not found in marketplace`);

        return textResult({
          pluginId: listing.pluginId,
          manifest: listing.manifest,
          status: listing.status,
          installCount: listing.installCount,
          averageRating: listing.averageRating,
          reviewCount: listing.reviewCount,
          featured: listing.featured,
        });
      } catch (err) {
        return errorResult(`Failed to get listing: ${err}`);
      }
    },
  );
}
