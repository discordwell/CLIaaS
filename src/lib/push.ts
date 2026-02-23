/**
 * Web Push notification sender with VAPID authentication.
 * Demo mode when VAPID keys are not configured.
 */

import { readJsonlFile, writeJsonlFile } from './jsonl-store';

// ---- Types ----

export interface PushSubscription {
  id: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userId?: string;
  createdAt: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

// ---- Config ----

export function getVapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@cliaas.com';

  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

export function isDemoMode(): boolean {
  return !process.env.VAPID_PUBLIC_KEY;
}

// ---- Subscription Store ----

const SUBSCRIPTIONS_FILE = 'push-subscriptions.jsonl';

const subscriptions: Map<string, PushSubscription> = new Map();
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const saved = readJsonlFile<PushSubscription>(SUBSCRIPTIONS_FILE);
  for (const sub of saved) {
    subscriptions.set(sub.id, sub);
  }
}

function persist(): void {
  writeJsonlFile(SUBSCRIPTIONS_FILE, Array.from(subscriptions.values()));
}

export function addSubscription(
  endpoint: string,
  keys: { p256dh: string; auth: string },
  userId?: string,
): PushSubscription {
  ensureLoaded();
  const sub: PushSubscription = {
    id: `push-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    endpoint,
    keys,
    userId,
    createdAt: new Date().toISOString(),
  };
  subscriptions.set(sub.id, sub);
  persist();
  return sub;
}

export function removeSubscription(endpoint: string): boolean {
  ensureLoaded();
  for (const [id, sub] of subscriptions) {
    if (sub.endpoint === endpoint) {
      subscriptions.delete(id);
      persist();
      return true;
    }
  }
  return false;
}

export function listSubscriptions(): PushSubscription[] {
  ensureLoaded();
  return Array.from(subscriptions.values());
}

// ---- Send Push ----

export async function sendPush(payload: PushPayload): Promise<{ sent: number; failed: number }> {
  ensureLoaded();
  const config = getVapidConfig();

  if (!config) {
    // Demo mode: log and return mock
    return { sent: subscriptions.size, failed: 0 };
  }

  // Use web-push library
  let webpush: typeof import('web-push');
  try {
    webpush = await import('web-push');
  } catch {
    return { sent: 0, failed: subscriptions.size };
  }

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  let sent = 0;
  let failed = 0;

  const promises = Array.from(subscriptions.values()).map(async (sub) => {
    try {
      await webpush!.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: sub.keys,
        },
        JSON.stringify(payload),
      );
      sent++;
    } catch (err: unknown) {
      failed++;
      // Remove expired subscriptions (410 Gone)
      if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 410) {
        subscriptions.delete(sub.id);
      }
    }
  });

  await Promise.allSettled(promises);
  persist();
  return { sent, failed };
}
