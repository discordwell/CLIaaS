import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginManifestV2, PluginInstallation, MarketplaceListing } from '@/lib/plugins/types';

// In-memory data stores for integration test
let installations: PluginInstallation[] = [];
let listings: MarketplaceListing[] = [];
let logs: Array<{ installationId: string; hookName: string; status: string }> = [];

vi.mock('@/lib/jsonl-store', () => ({
  readJsonlFile: (filename: string) => {
    if (filename === 'plugin-installations.jsonl') return installations;
    if (filename === 'marketplace-listings.jsonl') return listings;
    return [];
  },
  writeJsonlFile: (filename: string, data: unknown[]) => {
    if (filename === 'plugin-installations.jsonl') installations = data as PluginInstallation[];
    if (filename === 'marketplace-listings.jsonl') listings = data as MarketplaceListing[];
  },
}));

vi.mock('@/db', () => ({ getDb: () => null }));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

const { upsertListing, getListing } = await import('@/lib/plugins/marketplace-store');
const { installPlugin, getInstallations, togglePlugin, uninstallPlugin, getInstallationByPluginId } =
  await import('@/lib/plugins/store');

const testManifest: PluginManifestV2 = {
  id: 'integration-test-plugin',
  name: 'Integration Test Plugin',
  version: '1.0.0',
  description: 'A test plugin for integration testing',
  author: 'Test Suite',
  hooks: ['ticket.created'],
  permissions: ['tickets:read'],
  actions: [],
  uiSlots: [],
  oauthRequirements: [],
  runtime: 'node',
  entrypoint: 'return { processed: true };',
};

beforeEach(() => {
  installations = [];
  listings = [];
  logs = [];
});

describe('Plugin integration flow', () => {
  it('publish → install → enable → disable → uninstall', async () => {
    // 1. Publish to marketplace
    const listing = await upsertListing({
      pluginId: testManifest.id,
      manifest: testManifest,
      status: 'published',
    });
    expect(listing.status).toBe('published');
    expect(listing.pluginId).toBe('integration-test-plugin');

    // 2. Verify in marketplace
    const found = await getListing('integration-test-plugin');
    expect(found).not.toBeNull();
    expect(found!.manifest.name).toBe('Integration Test Plugin');

    // 3. Install
    const installation = await installPlugin({
      pluginId: testManifest.id,
      version: testManifest.version,
      config: { key: 'value' },
      hooks: testManifest.hooks,
    });
    expect(installation.pluginId).toBe('integration-test-plugin');
    expect(installation.enabled).toBe(false);

    // 4. Verify installed
    const allInstalled = await getInstallations();
    expect(allInstalled).toHaveLength(1);

    // 5. Enable
    const enabled = await togglePlugin(installation.id, true);
    expect(enabled?.enabled).toBe(true);

    // 6. Disable
    const disabled = await togglePlugin(installation.id, false);
    expect(disabled?.enabled).toBe(false);

    // 7. Uninstall
    const removed = await uninstallPlugin(installation.id);
    expect(removed).toEqual({ deleted: true, dependents: [] });

    // 8. Verify removed
    const afterUninstall = await getInstallations();
    expect(afterUninstall).toHaveLength(0);

    const byPluginId = await getInstallationByPluginId('integration-test-plugin');
    expect(byPluginId).toBeNull();
  });
});
