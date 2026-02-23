import { NextResponse } from 'next/server';
import { sendPush, type PushPayload } from '@/lib/push';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.title || !body?.body) {
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
