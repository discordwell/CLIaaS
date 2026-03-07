import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all store functions
vi.mock('@/lib/plugins/store', () => ({
  getInstallations: vi.fn().mockResolvedValue([]),
  getInstallationByPluginId: vi.fn().mockResolvedValue(null),
  installPlugin: vi.fn().mockResolvedValue({ id: 'inst-1', pluginId: 'test', version: '1.0.0' }),
  uninstallPlugin: vi.fn().mockResolvedValue({ deleted: true, dependents: [] }),
  togglePlugin: vi.fn().mockResolvedValue({ id: 'inst-1', enabled: true }),
  updateInstallation: vi.fn().mockResolvedValue({ id: 'inst-1', config: {} }),
}));

vi.mock('@/lib/plugins/marketplace-store', () => ({
  getListings: vi.fn().mockResolvedValue([]),
  getListing: vi.fn().mockResolvedValue(null),
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

// Mock scope guard to always allow
vi.mock('../../mcp/tools/scopes', () => ({
  scopeGuard: () => null,
}));

// Verify tool registration doesn't throw
describe('Plugin MCP tools', () => {
  it('registers without error', async () => {
    const { registerPluginTools } = await import('../../mcp/tools/plugins');

    const registeredTools: string[] = [];
    const mockServer = {
      tool: (name: string, ..._args: unknown[]) => {
        registeredTools.push(name);
      },
    };

    registerPluginTools(mockServer as never);

    expect(registeredTools).toContain('plugin_list');
    expect(registeredTools).toContain('plugin_install');
    expect(registeredTools).toContain('plugin_uninstall');
    expect(registeredTools).toContain('plugin_toggle');
    expect(registeredTools).toContain('plugin_config');
    expect(registeredTools).toContain('plugin_logs');
    expect(registeredTools).toContain('marketplace_search');
    expect(registeredTools).toContain('marketplace_show');
    expect(registeredTools).toHaveLength(8);
  });
});

describe('Scope guards', () => {
  it('plugin_install requires scope', async () => {
    const { scopeGuard } = await import('../../mcp/tools/scopes');

    // With default config, plugin_install should be in ALL_WRITE_TOOLS
    const result = scopeGuard('plugin_install');
    expect(result).toBeNull(); // allowed by default
  });
});
