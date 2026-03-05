import { describe, it, expect, vi } from 'vitest';

// Mock the upstream module
const mockUpstreamPush = vi.fn().mockResolvedValue({ pushed: 2, skipped: 1, failed: 0, errors: [] });
const mockUpstreamStatus = vi.fn().mockResolvedValue([
  { connector: 'zendesk', pending: 3, pushed: 10, failed: 1, skipped: 0 },
]);
const mockUpstreamRetryFailed = vi.fn().mockResolvedValue({ pushed: 1, skipped: 0, failed: 0, errors: [] });

vi.mock('../../sync/upstream.js', () => ({
  upstreamPush: (...args: unknown[]) => mockUpstreamPush(...args),
  upstreamStatus: (...args: unknown[]) => mockUpstreamStatus(...args),
  upstreamRetryFailed: (...args: unknown[]) => mockUpstreamRetryFailed(...args),
}));

// Minimal MCP server mock that captures registered tools
type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;
const registeredTools = new Map<string, ToolHandler>();

const mockServer = {
  tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
    registeredTools.set(name, handler);
  },
};

import { registerSyncTools } from '../../mcp/tools/sync.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Register all sync tools (including the new upstream ones)
registerSyncTools(mockServer as unknown as McpServer);

describe('upstream_push MCP tool', () => {
  it('is registered', () => {
    expect(registeredTools.has('upstream_push')).toBe(true);
  });

  it('calls upstreamPush and returns result', async () => {
    const handler = registeredTools.get('upstream_push')!;
    const result = await handler({ connector: 'zendesk' }) as { content: Array<{ text: string }> };

    expect(mockUpstreamPush).toHaveBeenCalledWith('zendesk');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.pushed).toBe(2);
    expect(parsed.skipped).toBe(1);
  });

  it('calls upstreamPush without filter when no connector specified', async () => {
    const handler = registeredTools.get('upstream_push')!;
    await handler({});

    expect(mockUpstreamPush).toHaveBeenCalledWith(undefined);
  });
});

describe('upstream_status MCP tool', () => {
  it('is registered', () => {
    expect(registeredTools.has('upstream_status')).toBe(true);
  });

  it('returns connector status counts', async () => {
    const handler = registeredTools.get('upstream_status')!;
    const result = await handler({}) as { content: Array<{ text: string }> };

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.connectors).toHaveLength(1);
    expect(parsed.connectors[0].connector).toBe('zendesk');
    expect(parsed.connectors[0].pending).toBe(3);
  });

  it('returns empty message when no entries exist', async () => {
    mockUpstreamStatus.mockResolvedValueOnce([]);
    const handler = registeredTools.get('upstream_status')!;
    const result = await handler({}) as { content: Array<{ text: string }> };

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.message).toContain('No upstream');
  });
});

describe('upstream_retry MCP tool', () => {
  it('is registered', () => {
    expect(registeredTools.has('upstream_retry')).toBe(true);
  });

  it('calls upstreamRetryFailed and returns result', async () => {
    const handler = registeredTools.get('upstream_retry')!;
    const result = await handler({ connector: 'freshdesk' }) as { content: Array<{ text: string }> };

    expect(mockUpstreamRetryFailed).toHaveBeenCalledWith('freshdesk');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.pushed).toBe(1);
  });
});
