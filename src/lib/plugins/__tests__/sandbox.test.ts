import { describe, it, expect } from 'vitest';
import { executeSandboxed, executeWebhook } from '../sandbox';
import type { PluginHookContext } from '../types';

const testContext: PluginHookContext = {
  event: 'ticket.created',
  data: { ticketId: 'T-1', subject: 'Test' },
  timestamp: '2026-01-01T00:00:00Z',
  pluginId: 'test',
};

const mockSDK = {
  config: {},
  log: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
};

describe('executeSandboxed', () => {
  it('executes simple code', async () => {
    const result = await executeSandboxed(
      'return { processed: true };',
      testContext,
      mockSDK,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ processed: true });
  });

  it('has access to context', async () => {
    const result = await executeSandboxed(
      'return { event: context.event };',
      testContext,
      mockSDK,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ event: 'ticket.created' });
  });

  it('catches errors', async () => {
    const result = await executeSandboxed(
      'throw new Error("boom");',
      testContext,
      mockSDK,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('boom');
  });

  it('blocks access to process', async () => {
    const result = await executeSandboxed(
      'return { pid: typeof process };',
      testContext,
      mockSDK,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ pid: 'undefined' });
  });

  it('blocks access to require', async () => {
    const result = await executeSandboxed(
      'return { req: typeof require };',
      testContext,
      mockSDK,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ req: 'undefined' });
  });

  it('has access to SDK', async () => {
    const result = await executeSandboxed(
      'return { hasSDK: typeof cliaas === "object" };',
      testContext,
      mockSDK,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ hasSDK: true });
  });
});

describe('executeWebhook', () => {
  it('blocks localhost URLs', async () => {
    const result = await executeWebhook(
      'http://localhost:3000/hook',
      testContext,
      'secret',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('SSRF');
  });

  it('blocks 127.0.0.1', async () => {
    const result = await executeWebhook(
      'http://127.0.0.1/hook',
      testContext,
      'secret',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('SSRF');
  });

  it('blocks metadata endpoint', async () => {
    const result = await executeWebhook(
      'http://169.254.169.254/latest/meta-data/',
      testContext,
      'secret',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('SSRF');
  });
});
