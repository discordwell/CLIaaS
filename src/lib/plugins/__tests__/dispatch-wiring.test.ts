import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Dispatch-wiring tests: verify that executePluginHook correctly invokes
 * installed plugins for subscribed events, skips unrelated events, and
 * skips disabled plugins.
 */

// ---- Mocks ----

const mockGetEnabledInstallationsForHook = vi.fn().mockResolvedValue([]);
const mockGetListing = vi.fn().mockResolvedValue(null);
const mockLogExecution = vi.fn().mockResolvedValue(undefined);
const mockExecuteSandboxed = vi.fn().mockResolvedValue({ ok: true, data: {} });
const mockExecuteWebhook = vi.fn().mockResolvedValue({ ok: true, data: {} });

vi.mock('../store', () => ({
  getEnabledInstallationsForHook: (...args: unknown[]) => mockGetEnabledInstallationsForHook(...args),
}));

vi.mock('../marketplace-store', () => ({
  getListing: (...args: unknown[]) => mockGetListing(...args),
}));

vi.mock('../execution-log', () => ({
  logExecution: (...args: unknown[]) => mockLogExecution(...args),
}));

vi.mock('../sandbox', () => ({
  executeSandboxed: (...args: unknown[]) => mockExecuteSandboxed(...args),
  executeWebhook: (...args: unknown[]) => mockExecuteWebhook(...args),
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

// ---- Helpers ----

function makeInstallation(overrides: Partial<{
  id: string;
  workspaceId: string;
  pluginId: string;
  version: string;
  enabled: boolean;
  config: Record<string, unknown>;
}> = {}) {
  return {
    id: overrides.id ?? 'inst-1',
    workspaceId: overrides.workspaceId ?? 'ws-1',
    pluginId: overrides.pluginId ?? 'test-plugin',
    version: overrides.version ?? '1.0.0',
    enabled: overrides.enabled ?? true,
    config: overrides.config ?? {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeContext(event: string, data: Record<string, unknown> = {}, workspaceId?: string) {
  return {
    event,
    data,
    timestamp: new Date().toISOString(),
    workspaceId,
  };
}

// ---- Tests ----

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEnabledInstallationsForHook.mockResolvedValue([]);
  mockGetListing.mockResolvedValue(null);
  mockExecuteSandboxed.mockResolvedValue({ ok: true, data: {} });
  mockExecuteWebhook.mockResolvedValue({ ok: true, data: {} });
});

describe('dispatch-wiring: plugin hook execution via canonical events', () => {
  it('invokes installed plugins subscribed to ticket.created', async () => {
    const installation = makeInstallation({ pluginId: 'slack-notify' });
    mockGetEnabledInstallationsForHook.mockResolvedValue([installation]);
    mockGetListing.mockResolvedValue({
      manifest: {
        runtime: 'node',
        entrypoint: 'handler.js',
        permissions: [],
        hooks: ['ticket.created'],
      },
    });

    await executePluginHook('ticket.created', makeContext('ticket.created', { ticketId: 'T-100' }, 'ws-1'));

    // Store was queried with the correct hook name and workspace
    expect(mockGetEnabledInstallationsForHook).toHaveBeenCalledWith('ticket.created', 'ws-1');
    // Plugin was executed
    expect(mockExecuteSandboxed).toHaveBeenCalledTimes(1);
    // Execution was logged
    expect(mockLogExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 'inst-1',
        hookName: 'ticket.created',
        status: 'success',
      }),
    );
  });

  it('invokes webhook-type plugins for subscribed events', async () => {
    const installation = makeInstallation({ pluginId: 'webhook-plugin', id: 'inst-wh' });
    mockGetEnabledInstallationsForHook.mockResolvedValue([installation]);
    mockGetListing.mockResolvedValue({
      manifest: {
        runtime: 'webhook',
        webhookUrl: 'https://example.com/hook',
        permissions: [],
        hooks: ['customer.merged'],
      },
    });

    await executePluginHook('customer.merged', makeContext('customer.merged', { customerId: 'C-1' }));

    expect(mockExecuteWebhook).toHaveBeenCalledTimes(1);
    expect(mockExecuteWebhook).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({ event: 'customer.merged' }),
      expect.any(String),
    );
    expect(mockLogExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 'inst-wh',
        hookName: 'customer.merged',
        status: 'success',
      }),
    );
  });

  it('does not invoke unrelated plugins for non-subscribed events', async () => {
    // Store returns empty array — no plugins subscribed to this event
    mockGetEnabledInstallationsForHook.mockResolvedValue([]);

    await executePluginHook('sla.breached', makeContext('sla.breached', { ticketId: 'T-200' }));

    // No execution or logging should happen
    expect(mockExecuteSandboxed).not.toHaveBeenCalled();
    expect(mockExecuteWebhook).not.toHaveBeenCalled();
    expect(mockLogExecution).not.toHaveBeenCalled();
  });

  it('skips disabled plugins (store filters them out)', async () => {
    // getEnabledInstallationsForHook only returns enabled installations,
    // so disabled plugins never reach the executor
    mockGetEnabledInstallationsForHook.mockResolvedValue([]);

    await executePluginHook('ticket.updated', makeContext('ticket.updated', { ticketId: 'T-300' }));

    expect(mockGetEnabledInstallationsForHook).toHaveBeenCalledWith('ticket.updated', undefined);
    expect(mockExecuteSandboxed).not.toHaveBeenCalled();
    expect(mockExecuteWebhook).not.toHaveBeenCalled();
    expect(mockLogExecution).not.toHaveBeenCalled();
  });

  it('invokes multiple plugins for the same event independently', async () => {
    const installations = [
      makeInstallation({ id: 'inst-a', pluginId: 'plugin-a' }),
      makeInstallation({ id: 'inst-b', pluginId: 'plugin-b' }),
    ];
    mockGetEnabledInstallationsForHook.mockResolvedValue(installations);

    mockGetListing
      .mockResolvedValueOnce({
        manifest: { runtime: 'node', entrypoint: 'a.js', permissions: [], hooks: ['ticket.resolved'] },
      })
      .mockResolvedValueOnce({
        manifest: { runtime: 'node', entrypoint: 'b.js', permissions: [], hooks: ['ticket.resolved'] },
      });

    await executePluginHook('ticket.resolved', makeContext('ticket.resolved', { ticketId: 'T-400' }));

    expect(mockExecuteSandboxed).toHaveBeenCalledTimes(2);
    expect(mockLogExecution).toHaveBeenCalledTimes(2);
    expect(mockLogExecution).toHaveBeenCalledWith(expect.objectContaining({ installationId: 'inst-a' }));
    expect(mockLogExecution).toHaveBeenCalledWith(expect.objectContaining({ installationId: 'inst-b' }));
  });

  it('works with all canonical event categories (samples from each)', async () => {
    // Test a sample event from each domain category to verify
    // the executor is truly hook-agnostic (string-based matching)
    const sampleEvents = [
      'ticket.created',
      'message.created',
      'sla.breached',
      'customer.merged',
      'csat.submitted',
      'survey.sent',
      'campaign.sent',
      'forum.thread_created',
      'qa.review_created',
      'time.entry_created',
      'side_conversation.created',
      'ticket.merged',
      'campaign.activated',
      'tour.started',
      'message.displayed',
      'automation.executed',
    ];

    for (const event of sampleEvents) {
      vi.clearAllMocks();
      mockGetEnabledInstallationsForHook.mockResolvedValue([]);

      await executePluginHook(event, makeContext(event));

      expect(mockGetEnabledInstallationsForHook).toHaveBeenCalledWith(event, undefined);
    }
  });

  it('isolates failures — one plugin error does not block others', async () => {
    const installations = [
      makeInstallation({ id: 'inst-ok', pluginId: 'good-plugin' }),
      makeInstallation({ id: 'inst-fail', pluginId: 'bad-plugin' }),
    ];
    mockGetEnabledInstallationsForHook.mockResolvedValue(installations);

    mockGetListing
      .mockResolvedValueOnce({
        manifest: { runtime: 'node', entrypoint: 'good.js', permissions: [], hooks: ['ticket.created'] },
      })
      .mockResolvedValueOnce({
        manifest: { runtime: 'node', entrypoint: 'bad.js', permissions: [], hooks: ['ticket.created'] },
      });

    // First succeeds, second throws
    mockExecuteSandboxed
      .mockResolvedValueOnce({ ok: true, data: {} })
      .mockRejectedValueOnce(new Error('Plugin crashed'));

    await executePluginHook('ticket.created', makeContext('ticket.created'));

    // Both were attempted
    expect(mockExecuteSandboxed).toHaveBeenCalledTimes(2);
    // Both were logged (one success, one error)
    expect(mockLogExecution).toHaveBeenCalledTimes(2);
    expect(mockLogExecution).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 'inst-ok', status: 'success' }),
    );
    expect(mockLogExecution).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 'inst-fail', status: 'error' }),
    );
  });
});
