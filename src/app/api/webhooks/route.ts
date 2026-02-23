import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listWebhooks, createWebhook } from '@/lib/webhooks';
import type { WebhookEventType } from '@/lib/webhooks';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const webhooks = listWebhooks();
    return NextResponse.json({ webhooks });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list webhooks' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const { url, events, secret, enabled, retryPolicy } = body as {
      url?: string;
      events?: WebhookEventType[];
      secret?: string;
      enabled?: boolean;
      retryPolicy?: { maxAttempts?: number; delaysMs?: number[] };
    };

    if (!url || !url.trim()) {
      return NextResponse.json(
        { error: 'url is required' },
        { status: 400 }
      );
    }

    if (!events || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: 'events array is required and must contain at least one event type' },
        { status: 400 }
      );
    }

    const webhookSecret =
      secret ||
      `whsec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;

    const webhook = createWebhook({
      url: url.trim(),
      events,
      secret: webhookSecret,
      enabled: enabled ?? true,
      retryPolicy: {
        maxAttempts: retryPolicy?.maxAttempts ?? 3,
        delaysMs: retryPolicy?.delaysMs ?? [1000, 5000, 30000],
      },
    });

    return NextResponse.json({ webhook }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create webhook' },
      { status: 500 }
    );
  }
}
