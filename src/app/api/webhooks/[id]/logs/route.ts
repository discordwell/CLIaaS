import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getWebhook, getWebhookLogs } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const webhook = getWebhook(id);
    if (!webhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    const logs = getWebhookLogs(id);
    return NextResponse.json({ logs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get webhook logs' },
      { status: 500 }
    );
  }
}
