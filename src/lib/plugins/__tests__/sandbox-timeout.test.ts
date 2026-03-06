import { describe, it, expect } from 'vitest';
import { executeSandboxed } from '../sandbox';
import type { PluginHookContext } from '../types';

describe('sandbox async timeout', () => {
  const ctx: PluginHookContext = {
    event: 'ticket.created',
    data: { ticketId: 'test-1' },
    timestamp: new Date().toISOString(),
    workspaceId: 'test-ws',
    pluginId: 'test-plugin',
  };

  const sdk = {
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  it('kills async code that exceeds timeout', async () => {
    // Code that creates a long-running promise — should be killed by Promise.race timeout
    const code = `
      await new Promise(resolve => {
        const start = Date.now();
        while (Date.now() - start < 30000) {} // busy-wait 30s
        resolve('done');
      });
    `;

    const result = await executeSandboxed(code, ctx, sdk);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out|timeout/i);
  }, 10000);

  it('allows fast async code to complete', async () => {
    const code = `return { greeting: 'hello' };`;
    const result = await executeSandboxed(code, ctx, sdk);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ greeting: 'hello' });
  });
});
