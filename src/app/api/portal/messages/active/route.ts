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
  const active = getMessages().filter(m => {
    if (!m.isActive) return false;
    if (m.startAt && new Date(m.startAt) > now) return false;
    if (m.endAt && new Date(m.endAt) < now) return false;
    if (m.targetUrlPattern !== '*') {
      const escaped = m.targetUrlPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      if (!new RegExp(`^${escaped}$`).test(currentUrl)) return false;
    }
    if (m.maxImpressions > 0) {
      const count = getImpressionCount(m.id, customerId);
      if (count >= m.maxImpressions) return false;
    }
    return true;
  });

  return NextResponse.json({ messages: active });
}
