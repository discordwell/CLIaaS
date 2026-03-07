import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginInstallation, PluginManifestV2 } from '../types';

// Per-file mock data stores
let installationsData: PluginInstallation[] = [];
let listingsData: { pluginId: string; manifest: Partial<PluginManifestV2> }[] = [];

const mockRead = vi.fn((filename: string) => {
  if (filename === 'marketplace-listings.jsonl') return listingsData;
  return installationsData;
});
const mockWrite = vi.fn();

vi.mock('@/lib/jsonl-store', () => ({
  readJsonlFile: (...args: unknown[]) => mockRead(...(args as [string])),
  writeJsonlFile: (...args: unknown[]) => mockWrite(...(args as [])),
}));

vi.mock('@/db', () => ({ getDb: () => null }));

const {
  getInstallations,
  getInstallation,
  getInstallationByPluginId,
  installPlugin,
  uninstallPlugin,
  togglePlugin,
  updateInstallation,
  checkDependencies,
  findDependents,
} = await import('../store');

function makeInstallation(overrides: Partial<PluginInstallation> = {}): PluginInstallation {
  return {
    id: 'inst-1',
    workspaceId: 'default',
    pluginId: 'test-plugin',
    version: '1.0.0',
    enabled: false,
    config: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installationsData = [];
  listingsData = [];
});

describe('getInstallations', () => {
  it('returns empty array when no installations', async () => {
    const result = await getInstallations();
    expect(result).toEqual([]);
  });

  it('returns all installations', async () => {
    installationsData = [makeInstallation(), makeInstallation({ id: 'inst-2', pluginId: 'other' })];
    const result = await getInstallations();
    expect(result).toHaveLength(2);
  });
});

describe('getInstallation', () => {
  it('returns null for missing ID', async () => {
    const result = await getInstallation('nonexistent');
    expect(result).toBeNull();
  });

  it('finds installation by ID', async () => {
    installationsData = [makeInstallation()];
    const result = await getInstallation('inst-1');
    expect(result?.pluginId).toBe('test-plugin');
  });
});

describe('getInstallationByPluginId', () => {
  it('finds by plugin slug', async () => {
    installationsData = [makeInstallation()];
    const result = await getInstallationByPluginId('test-plugin');
    expect(result?.id).toBe('inst-1');
  });

  it('returns null for missing slug', async () => {
    const result = await getInstallationByPluginId('nope');
    expect(result).toBeNull();
  });
});

describe('installPlugin', () => {
  it('creates a new installation', async () => {
    const result = await installPlugin({
      pluginId: 'new-plugin',
      version: '2.0.0',
      config: { key: 'value' },
    });
    expect(result.pluginId).toBe('new-plugin');
    expect(result.version).toBe('2.0.0');
    expect(result.enabled).toBe(false);
    expect(result.config).toEqual({ key: 'value' });
    expect(mockWrite).toHaveBeenCalled();
  });
});

describe('updateInstallation', () => {
  it('updates config', async () => {
    installationsData = [makeInstallation()];
    const result = await updateInstallation('inst-1', { config: { newKey: true } });
    expect(result?.config).toEqual({ newKey: true });
  });

  it('returns null for missing ID', async () => {
    const result = await updateInstallation('missing', { enabled: true });
    expect(result).toBeNull();
  });
});

describe('togglePlugin', () => {
  it('enables a disabled plugin', async () => {
    installationsData = [makeInstallation({ enabled: false })];
    const result = await togglePlugin('inst-1', true);
    expect(result?.enabled).toBe(true);
  });
});

describe('uninstallPlugin', () => {
  it('removes an installation', async () => {
    installationsData = [makeInstallation()];
    const result = await uninstallPlugin('inst-1');
    expect(result.deleted).toBe(true);
    expect(result.dependents).toEqual([]);
    expect(mockWrite).toHaveBeenCalled();
  });

  it('returns deleted false for missing ID', async () => {
    const result = await uninstallPlugin('missing');
    expect(result.deleted).toBe(false);
  });

  it('returns dependents when other plugins depend on the uninstalled plugin', async () => {
    installationsData = [
      makeInstallation({ id: 'inst-base', pluginId: 'base-plugin' }),
      makeInstallation({ id: 'inst-dep', pluginId: 'dependent-plugin' }),
    ];
    listingsData = [
      {
        pluginId: 'dependent-plugin',
        manifest: {
          id: 'dependent-plugin',
          dependencies: ['base-plugin'],
        },
      },
    ];

    const result = await uninstallPlugin('inst-base');
    expect(result.deleted).toBe(true);
    expect(result.dependents).toEqual(['dependent-plugin']);
  });

  it('still allows uninstall even with dependents (warning only)', async () => {
    installationsData = [
      makeInstallation({ id: 'inst-core', pluginId: 'core-plugin' }),
      makeInstallation({ id: 'inst-a', pluginId: 'plugin-a' }),
      makeInstallation({ id: 'inst-b', pluginId: 'plugin-b' }),
    ];
    listingsData = [
      {
        pluginId: 'plugin-a',
        manifest: { id: 'plugin-a', dependencies: ['core-plugin'] },
      },
      {
        pluginId: 'plugin-b',
        manifest: { id: 'plugin-b', dependencies: ['core-plugin'] },
      },
    ];

    const result = await uninstallPlugin('inst-core');
    expect(result.deleted).toBe(true);
    expect(result.dependents).toContain('plugin-a');
    expect(result.dependents).toContain('plugin-b');
    expect(result.dependents).toHaveLength(2);
  });
});

// ---- Dependency resolution ----

describe('installPlugin — dependency checking', () => {
  it('succeeds when all dependencies are installed', async () => {
    installationsData = [
      makeInstallation({ id: 'inst-dep1', pluginId: 'dep-one' }),
      makeInstallation({ id: 'inst-dep2', pluginId: 'dep-two' }),
    ];

    const result = await installPlugin({
      pluginId: 'new-plugin',
      version: '1.0.0',
      dependencies: ['dep-one', 'dep-two'],
    });

    expect(result.pluginId).toBe('new-plugin');
    expect(mockWrite).toHaveBeenCalled();
  });

  it('throws when dependencies are missing', async () => {
    installationsData = [
      makeInstallation({ id: 'inst-dep1', pluginId: 'dep-one' }),
    ];

    await expect(
      installPlugin({
        pluginId: 'new-plugin',
        version: '1.0.0',
        dependencies: ['dep-one', 'dep-two', 'dep-three'],
      }),
    ).rejects.toThrow('Missing dependencies: dep-two, dep-three');
  });

  it('throws with helpful message including plugin name', async () => {
    await expect(
      installPlugin({
        pluginId: 'my-addon',
        version: '1.0.0',
        dependencies: ['missing-plugin'],
      }),
    ).rejects.toThrow('Install them before installing "my-addon"');
  });

  it('succeeds with no dependencies specified', async () => {
    const result = await installPlugin({
      pluginId: 'standalone',
      version: '1.0.0',
    });
    expect(result.pluginId).toBe('standalone');
  });

  it('succeeds with empty dependencies array', async () => {
    const result = await installPlugin({
      pluginId: 'standalone',
      version: '1.0.0',
      dependencies: [],
    });
    expect(result.pluginId).toBe('standalone');
  });
});

describe('checkDependencies', () => {
  it('returns empty array when all deps are installed', async () => {
    installationsData = [
      makeInstallation({ pluginId: 'a' }),
      makeInstallation({ id: 'inst-2', pluginId: 'b' }),
    ];
    const missing = await checkDependencies(['a', 'b']);
    expect(missing).toEqual([]);
  });

  it('returns missing plugin IDs', async () => {
    installationsData = [makeInstallation({ pluginId: 'a' })];
    const missing = await checkDependencies(['a', 'b', 'c']);
    expect(missing).toEqual(['b', 'c']);
  });

  it('returns all when nothing is installed', async () => {
    const missing = await checkDependencies(['x', 'y']);
    expect(missing).toEqual(['x', 'y']);
  });
});

describe('findDependents', () => {
  it('returns empty when no plugins depend on the target', async () => {
    installationsData = [
      makeInstallation({ pluginId: 'standalone' }),
    ];
    listingsData = [
      { pluginId: 'standalone', manifest: { id: 'standalone' } },
    ];
    const dependents = await findDependents('target-plugin');
    expect(dependents).toEqual([]);
  });

  it('finds plugins that list the target as a dependency', async () => {
    installationsData = [
      makeInstallation({ id: 'inst-a', pluginId: 'plugin-a' }),
      makeInstallation({ id: 'inst-b', pluginId: 'plugin-b' }),
      makeInstallation({ id: 'inst-c', pluginId: 'plugin-c' }),
    ];
    listingsData = [
      { pluginId: 'plugin-a', manifest: { id: 'plugin-a', dependencies: ['core'] } },
      { pluginId: 'plugin-b', manifest: { id: 'plugin-b' } },
      { pluginId: 'plugin-c', manifest: { id: 'plugin-c', dependencies: ['core', 'other'] } },
    ];
    const dependents = await findDependents('core');
    expect(dependents).toEqual(['plugin-a', 'plugin-c']);
  });

  it('does not include the target plugin itself', async () => {
    installationsData = [
      makeInstallation({ id: 'inst-self', pluginId: 'self-dep' }),
    ];
    listingsData = [
      { pluginId: 'self-dep', manifest: { id: 'self-dep', dependencies: ['self-dep'] } },
    ];
    const dependents = await findDependents('self-dep');
    expect(dependents).toEqual([]);
  });
});
