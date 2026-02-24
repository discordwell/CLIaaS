import { readJsonlFile, writeJsonlFile } from './jsonl-store';
import { createLogger } from './logger';

const logger = createLogger('plugins');

// ---- Types ----

export type PluginHookType =
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.resolved'
  | 'message.created'
  | 'sla.breached'
  | 'csat.submitted';

export interface PluginAction {
  id: string;
  name: string;
  description: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  hooks: PluginHookType[];
  actions: PluginAction[];
  enabled: boolean;
  installedAt: string;
  config?: Record<string, unknown>;
}

export interface PluginHookContext {
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export type PluginHandler = (context: PluginHookContext) => Promise<void> | void;

// ---- JSONL persistence ----

const PLUGINS_FILE = 'plugins.jsonl';

function persistPlugins(plugins: Map<string, PluginManifest>): void {
  writeJsonlFile(PLUGINS_FILE, Array.from(plugins.values()));
}

// ---- Plugin Registry ----

class PluginRegistryImpl {
  private plugins: Map<string, PluginManifest> = new Map();
  private handlers: Map<string, Map<string, PluginHandler>> = new Map();
  private initialized = false;

  private ensureDefaults(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Try loading from persisted JSONL file
    const saved = readJsonlFile<PluginManifest>(PLUGINS_FILE);
    if (saved.length > 0) {
      for (const plugin of saved) {
        this.plugins.set(plugin.id, plugin);
      }
      return;
    }

    // Fall back to demo defaults
    const demoPlugins: PluginManifest[] = [
      {
        id: 'github-sync',
        name: 'GitHub Sync',
        version: '1.2.0',
        description:
          'Automatically creates GitHub issues from support tickets and syncs status updates bi-directionally.',
        author: 'CLIaaS Team',
        hooks: ['ticket.created', 'ticket.updated', 'ticket.resolved'],
        actions: [
          {
            id: 'create-issue',
            name: 'Create GitHub Issue',
            description: 'Creates a new GitHub issue linked to this ticket',
          },
          {
            id: 'link-pr',
            name: 'Link Pull Request',
            description: 'Links a GitHub PR to this ticket for tracking',
          },
        ],
        enabled: true,
        installedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
        config: {
          repo: 'org/repo',
          labelPrefix: 'support:',
          autoCreate: true,
        },
      },
      {
        id: 'pagerduty-alerts',
        name: 'PagerDuty Alerts',
        version: '2.0.1',
        description:
          'Triggers PagerDuty incidents when SLA is breached or urgent tickets are created. Supports on-call rotation.',
        author: 'CLIaaS Team',
        hooks: ['sla.breached', 'ticket.created'],
        actions: [
          {
            id: 'trigger-incident',
            name: 'Trigger Incident',
            description: 'Creates a PagerDuty incident for this ticket',
          },
          {
            id: 'acknowledge',
            name: 'Acknowledge Incident',
            description: 'Acknowledges the linked PagerDuty incident',
          },
        ],
        enabled: true,
        installedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
        config: {
          serviceId: 'P1234ABC',
          urgencyFilter: ['urgent', 'high'],
          autoTrigger: true,
        },
      },
      {
        id: 'stripe-context',
        name: 'Stripe Context',
        version: '1.0.3',
        description:
          'Enriches tickets with Stripe customer data including subscription status, payment history, and MRR.',
        author: 'CLIaaS Team',
        hooks: ['ticket.created', 'message.created'],
        actions: [
          {
            id: 'lookup-customer',
            name: 'Lookup Stripe Customer',
            description: 'Fetches Stripe customer data for the requester',
          },
          {
            id: 'view-invoices',
            name: 'View Recent Invoices',
            description: 'Shows recent invoices for the customer',
          },
        ],
        enabled: true,
        installedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        config: {
          lookupBy: 'email',
          showMRR: true,
          invoiceLimit: 5,
        },
      },
    ];

    for (const plugin of demoPlugins) {
      this.plugins.set(plugin.id, plugin);
    }
  }

  register(manifest: Omit<PluginManifest, 'installedAt'>): PluginManifest {
    this.ensureDefaults();
    const plugin: PluginManifest = {
      ...manifest,
      installedAt: new Date().toISOString(),
    };
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

  async executeHook(hookName: string, context: PluginHookContext): Promise<void> {
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

// Singleton
const registry = new PluginRegistryImpl();

export const PluginRegistry = {
  register: (manifest: Omit<PluginManifest, 'installedAt'>) =>
    registry.register(manifest),
  unregister: (id: string) => registry.unregister(id),
  list: () => registry.list(),
  getPlugin: (id: string) => registry.getPlugin(id),
  registerHandler: (pluginId: string, hookName: string, handler: PluginHandler) =>
    registry.registerHandler(pluginId, hookName, handler),
};

export async function executePluginHook(
  hookName: string,
  context: PluginHookContext
): Promise<void> {
  return registry.executeHook(hookName, context);
}
