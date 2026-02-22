import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { testWebhook } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const { url, secret } = body as { url?: string; secret?: string };

    if (!url || !url.trim()) {
      return NextResponse.json(
        { error: 'url is required' },
        { status: 400 }
      );
    }

    const result = await testWebhook(url.trim(), secret ?? 'test-secret');
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to test webhook' },
      { status: 500 }
    );
  }
}
