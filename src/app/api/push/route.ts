import { NextResponse } from 'next/server';
import {
  addSubscription,
  removeSubscription,
  listSubscriptions,
  isDemoMode,
  getVapidConfig,
} from '@/lib/push';

export const dynamic = 'force-dynamic';

// GET: list subscriptions + config
export async function GET() {
  const subs = listSubscriptions();
  const vapid = getVapidConfig();

  return NextResponse.json({
    demo: isDemoMode(),
    vapidPublicKey: vapid?.publicKey ?? null,
    subscriptions: subs.length,
  });
}

// POST: add subscription
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
    return NextResponse.json(
      { error: 'endpoint and keys (p256dh, auth) are required' },
      { status: 400 },
    );
  }

  const sub = addSubscription(body.endpoint, body.keys, body.userId);
  return NextResponse.json({ ok: true, id: sub.id }, { status: 201 });
}

// DELETE: remove subscription
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.endpoint) {
    return NextResponse.json(
      { error: 'endpoint is required' },
      { status: 400 },
    );
  }

  const removed = removeSubscription(body.endpoint);
  return NextResponse.json({ ok: true, removed });
}
