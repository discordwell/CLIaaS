import { describe, it, expect, afterEach } from 'vitest';
import { isToolEnabled, loadScopes } from '../../mcp/tools/scopes';

const originalEnv = process.env.MCP_ENABLED_TOOLS;

afterEach(() => {
  if (originalEnv !== undefined) {
    process.env.MCP_ENABLED_TOOLS = originalEnv;
  } else {
    delete process.env.MCP_ENABLED_TOOLS;
  }
  delete process.env.MCP_MAX_BATCH_SIZE;
});

describe('MCP scopes', () => {
  it('enables all tools by default', () => {
    delete process.env.MCP_ENABLED_TOOLS;
    expect(isToolEnabled('ticket_update')).toBe(true);
    expect(isToolEnabled('ticket_reply')).toBe(true);
    expect(isToolEnabled('ai_resolve')).toBe(true);
  });

  it('restricts tools via MCP_ENABLED_TOOLS env var', () => {
    process.env.MCP_ENABLED_TOOLS = 'ticket_update,ticket_reply';
    expect(isToolEnabled('ticket_update')).toBe(true);
    expect(isToolEnabled('ticket_reply')).toBe(true);
    expect(isToolEnabled('ai_resolve')).toBe(false);
    expect(isToolEnabled('rule_create')).toBe(false);
  });

  it('reads max batch size from env', () => {
    process.env.MCP_MAX_BATCH_SIZE = '10';
    const scopes = loadScopes();
    expect(scopes.maxBatchSize).toBe(10);
  });

  it('defaults max batch size to 50', () => {
    delete process.env.MCP_MAX_BATCH_SIZE;
    const scopes = loadScopes();
    expect(scopes.maxBatchSize).toBe(50);
  });
});
