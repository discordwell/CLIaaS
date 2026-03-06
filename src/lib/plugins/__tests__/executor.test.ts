import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock stores
const mockGetInstallations = vi.fn().mockResolvedValue([]);
const mockGetListing = vi.fn().mockResolvedValue(null);
const mockLogExecution = vi.fn().mockResolvedValue(undefined);

vi.mock('../store', () => ({
  getEnabledInstallationsForHook: (...args: unknown[]) => mockGetInstallations(...args),
}));

vi.mock('../marketplace-store', () => ({
  getListing: (...args: unknown[]) => mockGetListing(...args),
}));

vi.mock('../execution-log', () => ({
  logExecution: (...args: unknown[]) => mockLogExecution(...args),
}));

vi.mock('../sandbox', () => ({
  executeSandboxed: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  executeWebhook: vi.fn().mockResolvedValue({ ok: true, data: {} }),
}));

vi.mock('../sdk-context', () => ({
  createPluginSDK: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

const { executePluginHook } = await import('../executor');

beforeEach(() => {
  vi.clearAllMocks();
  mockGetInstallations.mockResolvedValue([]);
});

describe('executePluginHook', () => {
  it('does nothing when no installations', async () => {
    await executePluginHook('ticket.created', {
      event: 'ticket.created',
      data: {},
      timestamp: new Date().toISOString(),
    });
    expect(mockLogExecution).not.toHaveBeenCalled();
  });

  it('skips disabled plugins (already filtered by store)', async () => {
    mockGetInstallations.mockResolvedValue([]);
    await executePluginHook('ticket.created', {
      event: 'ticket.created',
      data: {},
      timestamp: new Date().toISOString(),
    });
    expect(mockLogExecution).not.toHaveBeenCalled();
  });

  it('executes and logs for enabled installations', async () => {
    mockGetInstallations.mockResolvedValue([{
      id: 'inst-1',
      workspaceId: 'ws-1',
      pluginId: 'test-plugin',
      version: '1.0.0',
      enabled: true,
      config: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]);

    mockGetListing.mockResolvedValue({
      manifest: {
        runtime: 'node',
        entrypoint: 'return { ok: true };',
        permissions: [],
      },
    });

    await executePluginHook('ticket.created', {
      event: 'ticket.created',
      data: { ticketId: 'T-1' },
      timestamp: new Date().toISOString(),
    });

    expect(mockLogExecution).toHaveBeenCalledTimes(1);
    expect(mockLogExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 'inst-1',
        hookName: 'ticket.created',
        status: 'success',
      }),
    );
  });

  it('handles missing manifest gracefully', async () => {
    mockGetInstallations.mockResolvedValue([{
      id: 'inst-1',
      workspaceId: 'ws-1',
      pluginId: 'missing-plugin',
      version: '1.0.0',
      enabled: true,
      config: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]);

    mockGetListing.mockResolvedValue(null);

    await executePluginHook('ticket.created', {
      event: 'ticket.created',
      data: {},
      timestamp: new Date().toISOString(),
    });

    expect(mockLogExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        error: 'Plugin manifest not found',
      }),
    );
  });
});
