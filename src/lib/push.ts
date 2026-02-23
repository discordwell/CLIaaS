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

// ---- Subscription Store (global singleton for HMR survival) ----

const SUBSCRIPTIONS_FILE = 'push-subscriptions.jsonl';

declare global {
  // eslint-disable-next-line no-var
  var __cliaaPushSubs: Map<string, PushSubscription> | undefined;
  // eslint-disable-next-line no-var
  var __cliaaPushSubsLoaded: boolean | undefined;
}

function getStore(): Map<string, PushSubscription> {
  if (!global.__cliaaPushSubs) {
    global.__cliaaPushSubs = new Map();
  }
  if (!global.__cliaaPushSubsLoaded) {
    const saved = readJsonlFile<PushSubscription>(SUBSCRIPTIONS_FILE);
    for (const sub of saved) {
      global.__cliaaPushSubs.set(sub.id, sub);
    }
    global.__cliaaPushSubsLoaded = true;
  }
  return global.__cliaaPushSubs;
}

function persist(): void {
  writeJsonlFile(SUBSCRIPTIONS_FILE, Array.from(getStore().values()));
}

export function addSubscription(
  endpoint: string,
  keys: { p256dh: string; auth: string },
  userId?: string,
): PushSubscription {
  const store = getStore();
  const sub: PushSubscription = {
    id: `push-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    endpoint,
    keys,
    userId,
    createdAt: new Date().toISOString(),
  };
  store.set(sub.id, sub);
  persist();
  return sub;
}

export function removeSubscription(endpoint: string): boolean {
  const store = getStore();
  for (const [id, sub] of store) {
    if (sub.endpoint === endpoint) {
      store.delete(id);
      persist();
      return true;
    }
  }
  return false;
}

export function listSubscriptions(): PushSubscription[] {
  return Array.from(getStore().values());
}

// ---- Send Push ----

export async function sendPush(payload: PushPayload): Promise<{ sent: number; failed: number }> {
  const store = getStore();
  const config = getVapidConfig();

  if (!config) {
    // Demo mode: log and return mock
    return { sent: store.size, failed: 0 };
  }

  // Use web-push library
  let webpush: typeof import('web-push');
  try {
    webpush = await import('web-push');
  } catch {
    return { sent: 0, failed: store.size };
  }

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  let sent = 0;
  let failed = 0;
  let removedAny = false;

  const promises = Array.from(store.values()).map(async (sub) => {
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
        store.delete(sub.id);
        removedAny = true;
      }
    }
  });

  await Promise.allSettled(promises);
  if (removedAny) persist();
  return { sent, failed };
}
