/**
 * Plugin system barrel — re-exports from modular plugin platform.
 * Maintains backward compatibility for existing imports.
 */

import { readJsonlFile, writeJsonlFile } from './jsonl-store';
import { createLogger } from './logger';

// Re-export new types
export type { PluginHookType, PluginManifestV2, PluginInstallation, PluginHookContext, PluginHandlerResult } from './plugins/types';
export type { PluginAction } from './plugins/types';

// Re-export new modules
export { executePluginHook } from './plugins/executor';
export { getInstallations, getInstallation, installPlugin, uninstallPlugin, togglePlugin } from './plugins/store';
export { getListings, getListing, upsertListing } from './plugins/marketplace-store';
export { logExecution, getExecutionLogs } from './plugins/execution-log';

const logger = createLogger('plugins');

// ---- Legacy Types (kept for backward compat with existing API routes) ----

export type LegacyPluginHookType =
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.resolved'
  | 'message.created'
  | 'sla.breached'
  | 'csat.submitted';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  hooks: LegacyPluginHookType[];
  actions: Array<{ id: string; name: string; description: string }>;
  enabled: boolean;
  installedAt: string;
  config?: Record<string, unknown>;
}

export type PluginHandler = (context: { event: string; data: Record<string, unknown>; timestamp: string }) => Promise<void> | void;

// ---- JSONL persistence ----

const PLUGINS_FILE = 'plugins.jsonl';

function persistPlugins(plugins: Map<string, PluginManifest>): void {
  writeJsonlFile(PLUGINS_FILE, Array.from(plugins.values()));
}

// ---- Legacy Plugin Registry (kept for existing API routes) ----

class PluginRegistryImpl {
  private plugins: Map<string, PluginManifest> = new Map();
  private handlers: Map<string, Map<string, PluginHandler>> = new Map();
  private initialized = false;

  private ensureDefaults(): void {
    if (this.initialized) return;
    this.initialized = true;

    const saved = readJsonlFile<PluginManifest>(PLUGINS_FILE);
    for (const plugin of saved) {
      this.plugins.set(plugin.id, plugin);
    }
  }

  register(manifest: Omit<PluginManifest, 'installedAt'>): PluginManifest {
    this.ensureDefaults();
    const plugin: PluginManifest = { ...manifest, installedAt: new Date().toISOString() };
    this.plugins.set(plugin.id, plugin);
    persistPlugins(this.plugins);
    return plugin;
  }

  unregister(id: string): boolean {
    this.ensureDefaults();
    this.handlers.delete(id);
    const result = this.plugins.delete(id);
    if (result) persistPlugins(this.plugins);
    return result;
  }

  list(): PluginManifest[] {
    this.ensureDefaults();
    return Array.from(this.plugins.values());
  }

  getPlugin(id: string): PluginManifest | undefined {
    this.ensureDefaults();
    return this.plugins.get(id);
  }

  registerHandler(pluginId: string, hookName: string, handler: PluginHandler): void {
    this.ensureDefaults();
    if (!this.handlers.has(hookName)) {
      this.handlers.set(hookName, new Map());
    }
    this.handlers.get(hookName)!.set(pluginId, handler);
  }

  async executeHook(hookName: string, context: { event: string; data: Record<string, unknown>; timestamp: string }): Promise<void> {
    this.ensureDefaults();
    const hookHandlers = this.handlers.get(hookName);
    if (!hookHandlers) return;

    const promises: Promise<void>[] = [];
    for (const [pluginId, handler] of hookHandlers.entries()) {
      const plugin = this.plugins.get(pluginId);
      if (!plugin?.enabled) continue;
      promises.push(
        Promise.resolve(handler(context)).catch((err) => {
          logger.error({ pluginId, hookName, error: err instanceof Error ? err.message : 'Unknown' }, 'Plugin hook failed');
        })
      );
    }
    await Promise.allSettled(promises);
  }
}

const registry = new PluginRegistryImpl();

export const PluginRegistry = {
  register: (manifest: Omit<PluginManifest, 'installedAt'>) => registry.register(manifest),
  unregister: (id: string) => registry.unregister(id),
  list: () => registry.list(),
  getPlugin: (id: string) => registry.getPlugin(id),
  registerHandler: (pluginId: string, hookName: string, handler: PluginHandler) =>
    registry.registerHandler(pluginId, hookName, handler),
};
