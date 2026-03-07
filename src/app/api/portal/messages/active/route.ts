import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getMessages, getImpressionCount } from '@/lib/messages/message-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get('customerId');
  const currentUrl = searchParams.get('url') ?? '';

  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required' }, { status: 400 });
  }

  const now = new Date();
  const allMessages = await getMessages();
  const active = [];
  for (const m of allMessages) {
    if (!m.isActive) continue;
    if (m.startAt && new Date(m.startAt) > now) continue;
    if (m.endAt && new Date(m.endAt) < now) continue;
    if (m.targetUrlPattern !== '*') {
      const escaped = m.targetUrlPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      if (!new RegExp(`^${escaped}$`).test(currentUrl)) continue;
    }
    if (m.maxImpressions > 0) {
      const count = await getImpressionCount(m.id, customerId);
      if (count >= m.maxImpressions) continue;
    }
    active.push(m);
  }

  return NextResponse.json({ messages: active });
}
