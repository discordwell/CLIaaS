import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { testWebhook } from '@/lib/webhooks';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody<{ url?: string; secret?: string }>(request);
    if ('error' in parsed) return parsed.error;
    const { url, secret } = parsed.data;

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
