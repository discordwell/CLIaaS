import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { sendPush, type PushPayload } from '@/lib/push';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{ title?: string; body?: string; url?: string; tag?: string }>(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  if (!body.title || !body.body) {
    return NextResponse.json(
      { error: 'title and body are required' },
      { status: 400 },
    );
  }

  const payload: PushPayload = {
    title: body.title,
    body: body.body,
    url: body.url,
    tag: body.tag,
  };

  const result = await sendPush(payload);
  return NextResponse.json({ ok: true, ...result });
}
