import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  addSubscription,
  removeSubscription,
  listSubscriptions,
  isDemoMode,
  getVapidConfig,
} from '@/lib/push';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// GET: list subscriptions + config
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const subs = listSubscriptions();
  const vapid = getVapidConfig();

  return NextResponse.json({
    demo: isDemoMode(),
    vapidPublicKey: vapid?.publicKey ?? null,
    subscriptions: subs.length,
  });
}

// POST: add subscription
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{ endpoint?: string; keys?: { p256dh?: string; auth?: string }; userId?: string }>(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json(
      { error: 'endpoint and keys (p256dh, auth) are required' },
      { status: 400 },
    );
  }

  const sub = addSubscription(body.endpoint, body.keys as { p256dh: string; auth: string }, body.userId);
  return NextResponse.json({ ok: true, id: sub.id }, { status: 201 });
}

// DELETE: remove subscription
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{ endpoint?: string }>(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  if (!body.endpoint) {
    return NextResponse.json(
      { error: 'endpoint is required' },
      { status: 400 },
    );
  }

  const removed = removeSubscription(body.endpoint);
  return NextResponse.json({ ok: true, removed });
}
