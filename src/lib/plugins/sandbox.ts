/**
 * Sandboxed plugin execution via node:vm (local) or webhook (HTTP).
 */

import { createContext, runInContext } from 'node:vm';
import { createHmac } from 'node:crypto';
import type { PluginHookContext, PluginHandlerResult } from './types';

const SANDBOX_TIMEOUT_MS = 5000;
const WEBHOOK_TIMEOUT_MS = 10000;

// ---- SSRF prevention (reuse from webhooks.ts patterns) ----

const BLOCKED_HOSTNAMES = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal',
  '169.254.169.254',
]);

function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return BLOCKED_HOSTNAMES.has(parsed.hostname);
  } catch {
    return true;
  }
}

// ---- Node VM Sandbox ----

export async function executeSandboxed(
  code: string,
  context: PluginHookContext,
  sdk: Record<string, unknown>,
): Promise<PluginHandlerResult> {
  try {
    const sandbox = createContext({
      // Inject SDK and context
      cliaas: sdk,
      context,
      console: {
        log: (...args: unknown[]) => sdk.log && (sdk.log as { info: (...a: unknown[]) => void }).info(...args),
        warn: (...args: unknown[]) => sdk.log && (sdk.log as { warn: (...a: unknown[]) => void }).warn(...args),
        error: (...args: unknown[]) => sdk.log && (sdk.log as { error: (...a: unknown[]) => void }).error(...args),
      },
      // Restricted globals
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      Promise,
      Error,
      TypeError,
      RangeError,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      setTimeout: undefined,
      setInterval: undefined,
      process: undefined,
      require: undefined,
      __dirname: undefined,
      __filename: undefined,
      global: undefined,
      globalThis: undefined,
    });

    const wrappedCode = `
      (async () => {
        ${code}
      })()
    `;

    const result = await runInContext(wrappedCode, sandbox, {
      timeout: SANDBOX_TIMEOUT_MS,
      filename: `plugin-${context.pluginId ?? 'unknown'}.js`,
    });

    return { ok: true, data: result ?? {} };
  } catch (err) {
    // Cross-realm errors may not pass instanceof check
    const message = (err && typeof err === 'object' && 'message' in err)
      ? String((err as { message: string }).message)
      : err instanceof Error ? err.message : 'Unknown sandbox error';
    return { ok: false, error: message };
  }
}

// ---- Webhook Execution ----

export async function executeWebhook(
  webhookUrl: string,
  context: PluginHookContext,
  secret: string,
): Promise<PluginHandlerResult> {
  if (isBlockedUrl(webhookUrl)) {
    return { ok: false, error: 'Webhook URL blocked by SSRF policy' };
  }

  try {
    const payload = JSON.stringify(context);
    const signature = createHmac('sha256', secret).update(payload).digest('hex');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CLIaaS-Signature': `sha256=${signature}`,
          'X-CLIaaS-Event': context.event,
          'X-CLIaaS-Plugin': context.pluginId ?? '',
        },
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return { ok: false, error: `Webhook returned ${response.status}` };
      }

      const body = await response.json().catch(() => ({}));
      return { ok: true, data: body as Record<string, unknown> };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook execution failed';
    return { ok: false, error: message };
  }
}
