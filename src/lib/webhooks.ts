import { readJsonlFile, writeJsonlFile } from './jsonl-store';

// ---- Types ----

export type WebhookEventType =
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.resolved'
  | 'ticket.deleted'
  | 'message.created'
  | 'sla.breached'
  | 'csat.submitted'
  | 'agent.assigned'
  | 'tag.added'
  | 'tag.removed';

export interface RetryPolicy {
  maxAttempts: number;
  delaysMs: number[];
}

export interface WebhookConfig {
  id: string;
  url: string;
  events: WebhookEventType[];
  secret: string;
  enabled: boolean;
  retryPolicy: RetryPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookLog {
  id: string;
  webhookId: string;
  event: string;
  status: 'success' | 'failed' | 'pending';
  responseCode: number | null;
  timestamp: string;
  payload: Record<string, unknown>;
  attempt: number;
  error?: string;
}

export interface WebhookEvent {
  type: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

// ---- JSONL persistence ----

const WEBHOOKS_FILE = 'webhooks.jsonl';
const WEBHOOK_LOGS_FILE = 'webhook-logs.jsonl';

function persistWebhooks(): void {
  writeJsonlFile(WEBHOOKS_FILE, webhooks);
}

function persistWebhookLogs(): void {
  const allLogs: WebhookLog[] = [];
  for (const logs of webhookLogs.values()) {
    allLogs.push(...logs);
  }
  writeJsonlFile(WEBHOOK_LOGS_FILE, allLogs);
}

// ---- In-memory stores ----

const webhooks: WebhookConfig[] = [];
const webhookLogs: Map<string, WebhookLog[]> = new Map();

let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  // Try loading from persisted JSONL files
  const savedWebhooks = readJsonlFile<WebhookConfig>(WEBHOOKS_FILE);
  const savedLogs = readJsonlFile<WebhookLog>(WEBHOOK_LOGS_FILE);

  if (savedWebhooks.length > 0) {
    webhooks.push(...savedWebhooks);
    for (const log of savedLogs) {
      const existing = webhookLogs.get(log.webhookId) ?? [];
      existing.push(log);
      webhookLogs.set(log.webhookId, existing);
    }
    return;
  }

  // Fall back to demo defaults
  webhooks.push(
    {
      id: 'wh-demo-1',
      url: 'https://hooks.example.com/cliaas/tickets',
      events: ['ticket.created', 'ticket.updated', 'ticket.resolved'],
      secret: 'whsec_demo_abc123def456',
      enabled: true,
      retryPolicy: { maxAttempts: 3, delaysMs: [1000, 5000, 30000] },
      createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    },
    {
      id: 'wh-demo-2',
      url: 'https://hooks.example.com/cliaas/sla',
      events: ['sla.breached'],
      secret: 'whsec_demo_xyz789ghi012',
      enabled: true,
      retryPolicy: { maxAttempts: 3, delaysMs: [1000, 5000, 30000] },
      createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    },
    {
      id: 'wh-demo-3',
      url: 'https://hooks.example.com/cliaas/csat',
      events: ['csat.submitted', 'ticket.resolved'],
      secret: 'whsec_demo_mno345pqr678',
      enabled: false,
      retryPolicy: { maxAttempts: 3, delaysMs: [1000, 5000, 30000] },
      createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    }
  );

  // Add some demo logs
  const demoLogs: WebhookLog[] = [
    {
      id: 'log-1',
      webhookId: 'wh-demo-1',
      event: 'ticket.created',
      status: 'success',
      responseCode: 200,
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      payload: { ticketId: 'demo-tk-1', subject: 'Login issue' },
      attempt: 1,
    },
    {
      id: 'log-2',
      webhookId: 'wh-demo-1',
      event: 'ticket.updated',
      status: 'success',
      responseCode: 200,
      timestamp: new Date(Date.now() - 1800000).toISOString(),
      payload: { ticketId: 'demo-tk-1', field: 'status', value: 'open' },
      attempt: 1,
    },
    {
      id: 'log-3',
      webhookId: 'wh-demo-2',
      event: 'sla.breached',
      status: 'failed',
      responseCode: 502,
      timestamp: new Date(Date.now() - 900000).toISOString(),
      payload: { ticketId: 'demo-tk-2', policyId: 'sla-urgent' },
      attempt: 3,
      error: 'Bad Gateway',
    },
  ];

  for (const log of demoLogs) {
    const existing = webhookLogs.get(log.webhookId) ?? [];
    existing.push(log);
    webhookLogs.set(log.webhookId, existing);
  }
}

// ---- HMAC Signature ----

async function computeHmacSignature(
  payload: string,
  secret: string
): Promise<string> {
  // In Node.js environment, use crypto
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await globalThis.crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(payload)
    );
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback: use Node crypto
  const { createHmac } = await import('crypto');
  return createHmac('sha256', secret).update(payload).digest('hex');
}

// ---- URL Validation (SSRF prevention) ----

const BLOCKED_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'];
const PRIVATE_IP_PATTERNS = [
  /^10\./,             // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./,  // 172.16.0.0/12
  /^192\.168\./,       // 192.168.0.0/16
  /^169\.254\./,       // link-local
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10
];

export function validateWebhookUrl(url: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'Webhook URLs must use HTTPS' };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { valid: false, error: 'Webhook URLs cannot target localhost' };
  }

  if (PRIVATE_IP_PATTERNS.some((p) => p.test(hostname))) {
    return { valid: false, error: 'Webhook URLs cannot target private/internal IPs' };
  }

  return { valid: true };
}

// ---- Public API ----

export function listWebhooks(): WebhookConfig[] {
  ensureDefaults();
  return [...webhooks];
}

export function getWebhook(id: string): WebhookConfig | undefined {
  ensureDefaults();
  return webhooks.find((w) => w.id === id);
}

export function createWebhook(
  input: Omit<WebhookConfig, 'id' | 'createdAt' | 'updatedAt'>
): WebhookConfig {
  ensureDefaults();
  const urlCheck = validateWebhookUrl(input.url);
  if (!urlCheck.valid) throw new Error(urlCheck.error);
  const webhook: WebhookConfig = {
    ...input,
    id: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  webhooks.push(webhook);
  persistWebhooks();
  return webhook;
}

export function updateWebhook(
  id: string,
  updates: Partial<Omit<WebhookConfig, 'id' | 'createdAt'>>
): WebhookConfig | null {
  ensureDefaults();
  const idx = webhooks.findIndex((w) => w.id === id);
  if (idx === -1) return null;
  if (updates.url) {
    const urlCheck = validateWebhookUrl(updates.url);
    if (!urlCheck.valid) throw new Error(urlCheck.error);
  }
  webhooks[idx] = {
    ...webhooks[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  persistWebhooks();
  return webhooks[idx];
}

export function deleteWebhook(id: string): boolean {
  ensureDefaults();
  const idx = webhooks.findIndex((w) => w.id === id);
  if (idx === -1) return false;
  webhooks.splice(idx, 1);
  webhookLogs.delete(id);
  persistWebhooks();
  persistWebhookLogs();
  return true;
}

// ---- Logging ----

export function recordWebhookLog(log: Omit<WebhookLog, 'id'>): WebhookLog {
  ensureDefaults();
  const entry: WebhookLog = {
    ...log,
    id: `whl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  const existing = webhookLogs.get(log.webhookId) ?? [];
  existing.push(entry);
  // Keep last 100 logs per webhook
  if (existing.length > 100) {
    existing.splice(0, existing.length - 100);
  }
  webhookLogs.set(log.webhookId, existing);
  persistWebhookLogs();
  return entry;
}

export function getWebhookLogs(webhookId: string): WebhookLog[] {
  ensureDefaults();
  return [...(webhookLogs.get(webhookId) ?? [])];
}

// ---- Dispatch ----

async function sendWithRetry(
  webhook: WebhookConfig,
  event: WebhookEvent
): Promise<void> {
  const urlCheck = validateWebhookUrl(webhook.url);
  if (!urlCheck.valid) return;

  const payload = JSON.stringify({
    event: event.type,
    timestamp: event.timestamp,
    data: event.data,
  });

  const signature = await computeHmacSignature(payload, webhook.secret);

  for (let attempt = 0; attempt < webhook.retryPolicy.maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = webhook.retryPolicy.delaysMs[attempt - 1] ?? 30000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CLIaaS-Signature': `sha256=${signature}`,
          'X-CLIaaS-Event': event.type,
        },
        body: payload,
        signal: AbortSignal.timeout(10000),
      });

      recordWebhookLog({
        webhookId: webhook.id,
        event: event.type,
        status: res.ok ? 'success' : 'failed',
        responseCode: res.status,
        timestamp: new Date().toISOString(),
        payload: event.data,
        attempt: attempt + 1,
        error: res.ok ? undefined : `HTTP ${res.status}`,
      });

      if (res.ok) return;
    } catch (err) {
      recordWebhookLog({
        webhookId: webhook.id,
        event: event.type,
        status: 'failed',
        responseCode: null,
        timestamp: new Date().toISOString(),
        payload: event.data,
        attempt: attempt + 1,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
}

export async function dispatchWebhook(event: WebhookEvent): Promise<void> {
  ensureDefaults();
  const matching = webhooks.filter(
    (w) => w.enabled && w.events.includes(event.type)
  );

  await Promise.allSettled(
    matching.map((w) => sendWithRetry(w, event))
  );
}

// ---- Test dispatch (single webhook, single attempt) ----

export async function testWebhook(
  url: string,
  secret: string
): Promise<{ success: boolean; responseCode: number | null; error?: string }> {
  const urlCheck = validateWebhookUrl(url);
  if (!urlCheck.valid) return { success: false, responseCode: null, error: urlCheck.error };

  const event: WebhookEvent = {
    type: 'ticket.created',
    timestamp: new Date().toISOString(),
    data: {
      ticketId: 'test-123',
      subject: 'Test webhook event',
      status: 'open',
      priority: 'normal',
    },
  };

  const payload = JSON.stringify({
    event: event.type,
    timestamp: event.timestamp,
    data: event.data,
  });

  const signature = await computeHmacSignature(payload, secret);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CLIaaS-Signature': `sha256=${signature}`,
        'X-CLIaaS-Event': event.type,
        'X-CLIaaS-Test': 'true',
      },
      body: payload,
      signal: AbortSignal.timeout(10000),
    });

    return {
      success: res.ok,
      responseCode: res.status,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      success: false,
      responseCode: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
