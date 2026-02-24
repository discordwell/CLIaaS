/**
 * Single-attempt webhook delivery — extracted from webhooks.ts sendWithRetry.
 * Used by the BullMQ webhook worker for per-attempt processing.
 */

import { validateWebhookUrl, recordWebhookLog } from '../../webhooks';
import { createLogger } from '../../logger';
import type { WebhookDeliveryJob } from '../types';

const logger = createLogger('queue:webhook-processor');

export interface DeliveryResult {
  success: boolean;
  responseCode: number | null;
  error?: string;
}

/** Compute HMAC-SHA256 signature for webhook payload. */
async function computeHmacSignature(payload: string, secret: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  const { createHmac } = await import('crypto');
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Deliver a webhook once (single attempt). BullMQ handles retries. */
export async function deliverWebhook(job: WebhookDeliveryJob, attempt: number): Promise<DeliveryResult> {
  const urlCheck = validateWebhookUrl(job.url);
  if (!urlCheck.valid) {
    logger.warn({ webhookId: job.webhookId, error: urlCheck.error }, 'Invalid webhook URL');
    return { success: false, responseCode: null, error: urlCheck.error };
  }

  const payload = JSON.stringify({
    event: job.event,
    timestamp: job.timestamp,
    data: job.data,
  });

  const signature = await computeHmacSignature(payload, job.secret);

  try {
    const res = await fetch(job.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CLIaaS-Signature': `sha256=${signature}`,
        'X-CLIaaS-Event': job.event,
      },
      body: payload,
      signal: AbortSignal.timeout(10000),
    });

    recordWebhookLog({
      webhookId: job.webhookId,
      event: job.event,
      status: res.ok ? 'success' : 'failed',
      responseCode: res.status,
      timestamp: new Date().toISOString(),
      payload: job.data,
      attempt,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    });

    if (!res.ok) {
      return { success: false, responseCode: res.status, error: `HTTP ${res.status}` };
    }

    return { success: true, responseCode: res.status };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    recordWebhookLog({
      webhookId: job.webhookId,
      event: job.event,
      status: 'failed',
      responseCode: null,
      timestamp: new Date().toISOString(),
      payload: job.data,
      attempt,
      error,
    });
    return { success: false, responseCode: null, error };
  }
}
