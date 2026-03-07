/**
 * Phase 4: Sandbox Security Tests
 *
 * 4.5 Plugin Sandbox:
 * - Blocked globals (require, process, global, globalThis, setTimeout, setInterval)
 * - 5-second timeout enforcement
 * - Error isolation
 * - Webhook SSRF prevention
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeSandboxed, executeWebhook } from '@/lib/plugins/sandbox';
import type { PluginHookContext } from '@/lib/plugins/types';

// Mock DNS resolution for webhook tests (prevent real DNS lookups)
// Returns loopback for localhost, public IP for everything else
vi.mock('node:dns/promises', () => ({
  resolve4: vi.fn().mockImplementation((hostname: string) => {
    if (hostname === 'localhost') return Promise.resolve(['127.0.0.1']);
    return Promise.resolve(['93.184.216.34']);
  }),
}));

const testContext: PluginHookContext = {
  event: 'ticket.created',
  data: { ticketId: 'T-1', subject: 'Test Ticket' },
  timestamp: '2026-03-06T00:00:00Z',
  workspaceId: 'ws-test',
  pluginId: 'test-plugin',
};

const mockSDK = {
  config: {},
  log: {
    info: (..._args: unknown[]) => {},
    warn: (..._args: unknown[]) => {},
    error: (..._args: unknown[]) => {},
  },
};

// ---- 4.5 Plugin Sandbox ----

describe('4.5 Plugin Sandbox', () => {
  describe('sandbox blocks dangerous globals', () => {
    it('blocks access to require', async () => {
      const result = await executeSandboxed(
        'return { type: typeof require };',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ type: 'undefined' });
    });

    it('blocks require("child_process") call', async () => {
      const result = await executeSandboxed(
        `
        try {
          const cp = require("child_process");
          return { hasCP: true };
        } catch (e) {
          return { blocked: true, error: e.message || String(e) };
        }
        `,
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      // Should either get "undefined" error or be blocked
      if (result.data && typeof result.data === 'object' && 'blocked' in result.data) {
        expect((result.data as Record<string, unknown>).blocked).toBe(true);
      }
      // Must never successfully import child_process
      expect(result.data).not.toEqual({ hasCP: true });
    });

    it('blocks access to process', async () => {
      const result = await executeSandboxed(
        'return { type: typeof process };',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ type: 'undefined' });
    });

    it('blocks access to process.env', async () => {
      const result = await executeSandboxed(
        `
        try {
          const env = process.env;
          return { hasEnv: true, keys: Object.keys(env) };
        } catch (e) {
          return { blocked: true };
        }
        `,
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      // process is undefined, so accessing .env should throw
      expect(result.data).not.toHaveProperty('hasEnv');
    });

    it('blocks access to global', async () => {
      const result = await executeSandboxed(
        'return { type: typeof global };',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ type: 'undefined' });
    });

    it('blocks access to globalThis', async () => {
      const result = await executeSandboxed(
        'return { type: typeof globalThis };',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ type: 'undefined' });
    });

    it('blocks access to setTimeout', async () => {
      const result = await executeSandboxed(
        'return { type: typeof setTimeout };',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ type: 'undefined' });
    });

    it('blocks access to setInterval', async () => {
      const result = await executeSandboxed(
        'return { type: typeof setInterval };',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ type: 'undefined' });
    });

    it('blocks access to __dirname', async () => {
      const result = await executeSandboxed(
        'return { type: typeof __dirname };',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ type: 'undefined' });
    });

    it('blocks access to __filename', async () => {
      const result = await executeSandboxed(
        'return { type: typeof __filename };',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ type: 'undefined' });
    });
  });

  describe('sandbox provides safe globals', () => {
    it('allows access to JSON', async () => {
      const result = await executeSandboxed(
        'return { parsed: JSON.parse(\'{"a":1}\') };',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ parsed: { a: 1 } });
    });

    it('allows access to Math', async () => {
      const result = await executeSandboxed(
        'return { pi: Math.PI };',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect((result.data as Record<string, number>).pi).toBeCloseTo(3.14159, 4);
    });

    it('allows access to Date', async () => {
      const result = await executeSandboxed(
        'return { isDate: typeof Date === "function" };',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ isDate: true });
    });

    it('allows access to Promise', async () => {
      const result = await executeSandboxed(
        'const v = await Promise.resolve(42); return { v };',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ v: 42 });
    });

    it('provides access to context and SDK', async () => {
      const result = await executeSandboxed(
        'return { event: context.event, hasSDK: typeof cliaas === "object" };',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ event: 'ticket.created', hasSDK: true });
    });
  });

  describe('5-second timeout kills long-running code', () => {
    it('kills synchronous infinite loop', async () => {
      const result = await executeSandboxed(
        'while(true) {}',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/timed out|timeout|Script execution timed out/i);
    }, 10000);

    it('kills busy-wait async code', async () => {
      const result = await executeSandboxed(
        `
        await new Promise(resolve => {
          const start = Date.now();
          while (Date.now() - start < 30000) {}
          resolve('done');
        });
        `,
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/timed out|timeout/i);
    }, 10000);

    it('allows fast code to complete within timeout', async () => {
      const result = await executeSandboxed(
        'return { sum: 1 + 2 + 3 };',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ sum: 6 });
    });
  });

  describe('sandbox error isolation (one plugin failure does not crash others)', () => {
    it('catches thrown errors and returns error result', async () => {
      const result = await executeSandboxed(
        'throw new Error("plugin crashed");',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('plugin crashed');
    });

    it('subsequent execution works after a failure', async () => {
      // First execution: crash
      const result1 = await executeSandboxed(
        'throw new Error("crash");',
        testContext,
        mockSDK,
      );
      expect(result1.ok).toBe(false);

      // Second execution: should work fine
      const result2 = await executeSandboxed(
        'return { healthy: true };',
        testContext,
        mockSDK,
      );
      expect(result2.ok).toBe(true);
      expect(result2.data).toEqual({ healthy: true });
    });

    it('catches TypeError in sandboxed code', async () => {
      const result = await executeSandboxed(
        'const x = null; return x.property;',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('catches RangeError in sandboxed code', async () => {
      const result = await executeSandboxed(
        'function recurse() { recurse(); } recurse();',
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('isolates errors between different plugin contexts', async () => {
      const ctx1 = { ...testContext, pluginId: 'plugin-a' };
      const ctx2 = { ...testContext, pluginId: 'plugin-b' };

      // Plugin A crashes
      const resultA = await executeSandboxed(
        'throw new Error("Plugin A died");',
        ctx1,
        mockSDK,
      );
      expect(resultA.ok).toBe(false);

      // Plugin B should be unaffected
      const resultB = await executeSandboxed(
        'return { pluginId: context.pluginId, ok: true };',
        ctx2,
        mockSDK,
      );
      expect(resultB.ok).toBe(true);
      expect(resultB.data).toEqual({ pluginId: 'plugin-b', ok: true });
    });
  });

  describe('webhook execution blocks private IPs (SSRF)', () => {
    it('blocks localhost webhook URL', async () => {
      const result = await executeWebhook(
        'http://localhost:3000/hook',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('blocks 127.0.0.1 webhook URL', async () => {
      const result = await executeWebhook(
        'http://127.0.0.1/hook',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('blocks 10.x.x.x private network', async () => {
      const result = await executeWebhook(
        'http://10.0.0.5/internal-api',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('blocks 192.168.x.x private network', async () => {
      const result = await executeWebhook(
        'http://192.168.1.100/hook',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('blocks 172.16.x.x private network', async () => {
      const result = await executeWebhook(
        'http://172.16.0.1/hook',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('blocks cloud metadata endpoint (169.254.169.254)', async () => {
      const result = await executeWebhook(
        'http://169.254.169.254/latest/meta-data/',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('blocks hex-encoded private IP (0x7f000001)', async () => {
      const result = await executeWebhook(
        'http://0x7f000001/hook',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('blocks decimal-encoded private IP (2130706433)', async () => {
      const result = await executeWebhook(
        'http://2130706433/hook',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('blocks Google metadata hostname', async () => {
      const result = await executeWebhook(
        'http://metadata.google.internal/computeMetadata/v1/',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('blocks Kubernetes metadata hostname', async () => {
      const result = await executeWebhook(
        'http://kubernetes.default.svc/api',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('blocks IPv6 loopback', async () => {
      const result = await executeWebhook(
        'http://[::1]/hook',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('blocks non-http protocols (file://)', async () => {
      const result = await executeWebhook(
        'file:///etc/passwd',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('blocks non-http protocols (ftp://)', async () => {
      const result = await executeWebhook(
        'ftp://internal.server/data',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('blocks 0.0.0.0', async () => {
      const result = await executeWebhook(
        'http://0.0.0.0/hook',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('blocks octal-encoded private IP (0177.0.0.1)', async () => {
      const result = await executeWebhook(
        'http://0177.0.0.1/hook',
        testContext,
        'webhook-secret',
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SSRF');
    });
  });

  describe('sandbox cannot escape to modify host globals', () => {
    it('FINDING: sandbox shares host Object — prototype mutation leaks through', async () => {
      // SECURITY FINDING: The sandbox passes the real `Object` constructor to
      // the VM context. This means sandboxed code can modify Object.prototype
      // and the changes are visible to the host. While the sandbox blocks
      // process/require/global, shared built-in constructors (Object, Array, etc.)
      // allow prototype pollution attacks.
      //
      // Mitigation: The sandbox should use frozen copies of built-in constructors
      // or run in a truly isolated context.

      const before = Object.prototype.hasOwnProperty.call(Object.prototype, 'pwned');
      expect(before).toBe(false);

      const result = await executeSandboxed(
        `
        try {
          Object.prototype.pwned = true;
          return { attempted: true };
        } catch (e) {
          return { blocked: true };
        }
        `,
        testContext,
        mockSDK,
      );

      // The modification DOES leak through (this documents the finding)
      const after = Object.prototype.hasOwnProperty.call(Object.prototype, 'pwned');
      expect(after).toBe(true); // Documents the finding: prototype pollution leaks

      // Clean up to prevent test pollution
      delete (Object.prototype as Record<string, unknown>).pwned;
    });

    it('cannot access node:fs through import', async () => {
      const result = await executeSandboxed(
        `
        try {
          const fs = require('fs');
          return { hasFs: true };
        } catch(e) {
          return { blocked: true };
        }
        `,
        testContext,
        mockSDK,
      );
      expect(result.ok).toBe(true);
      expect(result.data).not.toEqual({ hasFs: true });
    });
  });
});
