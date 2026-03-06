import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('@/lib/plugins/store', () => ({
  getInstallations: vi.fn().mockResolvedValue([]),
  getInstallationByPluginId: vi.fn(),
  installPlugin: vi.fn().mockResolvedValue({ id: 'inst-1', pluginId: 'test', version: '1.0.0' }),
  uninstallPlugin: vi.fn().mockResolvedValue(true),
  togglePlugin: vi.fn().mockResolvedValue({ id: 'inst-1', enabled: true }),
  updateInstallation: vi.fn().mockResolvedValue({ id: 'inst-1', config: {} }),
}));

vi.mock('@/lib/plugins/marketplace-store', () => ({
  getListings: vi.fn().mockResolvedValue([]),
  getListing: vi.fn(),
}));

vi.mock('@/lib/plugins/execution-log', () => ({
  getExecutionLogs: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

// Mock scopes to never block
vi.mock('../../../cli/mcp/tools/scopes', () => ({
  scopeGuard: () => null,
}));

import { getListing } from '@/lib/plugins/marketplace-store';
import { getInstallationByPluginId } from '@/lib/plugins/store';

describe('MCP plugin tools - JSON.parse error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('plugin_install returns helpful error on invalid JSON config', async () => {
    (getListing as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'listing-1',
      pluginId: 'test-plugin',
      manifest: { version: '1.0.0', hooks: [] },
    });

    // We need to test the handler directly since the MCP server tool registration
    // wraps it. Import the module and simulate calling the handler.
    const { registerPluginTools } = await import('../../../cli/mcp/tools/plugins');

    // Create a mock server that captures tool handlers
    const handlers = new Map<string, Function>();
    const mockServer = {
      tool: (name: string, _desc: string, _schema: unknown, handler: Function) => {
        handlers.set(name, handler);
      },
    };

    registerPluginTools(mockServer as any);

    const installHandler = handlers.get('plugin_install')!;
    const result = await installHandler({ pluginId: 'test-plugin', config: '{invalid json' });

    expect(result.content[0].text).toContain('Invalid JSON in config');
    expect(result.content[0].text).toContain('{invalid json');
  });

  it('plugin_config returns helpful error on invalid JSON config', async () => {
    (getInstallationByPluginId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'inst-1',
      pluginId: 'test-plugin',
      config: { existing: true },
    });

    const { registerPluginTools } = await import('../../../cli/mcp/tools/plugins');

    const handlers = new Map<string, Function>();
    const mockServer = {
      tool: (name: string, _desc: string, _schema: unknown, handler: Function) => {
        handlers.set(name, handler);
      },
    };

    registerPluginTools(mockServer as any);

    const configHandler = handlers.get('plugin_config')!;
    const result = await configHandler({ pluginId: 'test-plugin', config: 'not json' });

    expect(result.content[0].text).toContain('Invalid JSON in config');
  });
});
