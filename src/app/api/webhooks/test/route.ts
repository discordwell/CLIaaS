import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { testWebhook } from '@/lib/webhooks';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireScope } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireScope(request, 'webhooks:write');
  if ('error' in auth) return auth.error;

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
