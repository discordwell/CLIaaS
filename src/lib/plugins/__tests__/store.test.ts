import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginInstallation } from '../types';

const mockRead = vi.fn<() => PluginInstallation[]>().mockReturnValue([]);
const mockWrite = vi.fn();

vi.mock('@/lib/jsonl-store', () => ({
  readJsonlFile: (...args: unknown[]) => mockRead(...(args as [])),
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
  mockRead.mockReturnValue([]);
});

describe('getInstallations', () => {
  it('returns empty array when no installations', async () => {
    const result = await getInstallations();
    expect(result).toEqual([]);
  });

  it('returns all installations', async () => {
    mockRead.mockReturnValue([makeInstallation(), makeInstallation({ id: 'inst-2', pluginId: 'other' })]);
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
    mockRead.mockReturnValue([makeInstallation()]);
    const result = await getInstallation('inst-1');
    expect(result?.pluginId).toBe('test-plugin');
  });
});

describe('getInstallationByPluginId', () => {
  it('finds by plugin slug', async () => {
    mockRead.mockReturnValue([makeInstallation()]);
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
    mockRead.mockReturnValue([makeInstallation()]);
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
    mockRead.mockReturnValue([makeInstallation({ enabled: false })]);
    const result = await togglePlugin('inst-1', true);
    expect(result?.enabled).toBe(true);
  });
});

describe('uninstallPlugin', () => {
  it('removes an installation', async () => {
    mockRead.mockReturnValue([makeInstallation()]);
    const result = await uninstallPlugin('inst-1');
    expect(result).toBe(true);
    expect(mockWrite).toHaveBeenCalled();
  });

  it('returns false for missing ID', async () => {
    const result = await uninstallPlugin('missing');
    expect(result).toBe(false);
  });
});
