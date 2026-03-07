/**
 * Webhook Relay plugin handler.
 * Forwards all event payloads to a configured external URL via POST.
 * Supports HMAC-SHA256 signing for payload verification.
 * In production, this would make actual HTTP requests to the target URL.
 */

import type { PluginHookContext, PluginHandlerResult } from '../../types';
import { createHmac } from 'crypto';

function computeSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export async function handle(context: PluginHookContext): Promise<PluginHandlerResult> {
  const { event, data, config, timestamp, workspaceId } = context;
  const cfg = config ?? {};

  const url = cfg.url as string | undefined;
  if (!url) {
    return { ok: false, error: 'Webhook relay URL is required' };
  }

  // If events filter is configured, check if this event should be relayed
  const allowedEvents = cfg.events as string[] | undefined;
  if (allowedEvents && allowedEvents.length > 0 && !allowedEvents.includes(event)) {
    return {
      ok: true,
      data: { skipped: true, reason: `Event ${event} not in allowed list` },
    };
  }

  const payload = {
    event,
    data,
    timestamp,
    workspaceId: workspaceId || null,
  };

  const payloadJson = JSON.stringify(payload);
  const secret = cfg.secret as string | undefined;
  const signature = secret ? computeSignature(payloadJson, secret) : undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-CLIaaS-Event': event,
    'X-CLIaaS-Timestamp': timestamp,
  };

  if (signature) {
    headers['X-CLIaaS-Signature'] = `sha256=${signature}`;
  }

  // In production: POST to the configured URL with the payload and headers
  return {
    ok: true,
    data: {
      action: 'relay',
      url,
      method: 'POST',
      headers,
      payload,
      signed: !!secret,
    },
  };
}
