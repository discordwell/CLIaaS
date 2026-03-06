import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { recordImpression } from '@/lib/messages/message-store';
import { dispatch } from '@/lib/events/dispatcher';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody<{
    customerId: string;
    action: 'displayed' | 'dismissed' | 'clicked' | 'cta_clicked';
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { customerId, action } = parsed.data;
  if (!customerId || !action) {
    return NextResponse.json({ error: 'customerId and action are required' }, { status: 400 });
  }

  const impression = recordImpression(id, customerId, action);

  const eventMap: Record<string, string> = {
    displayed: 'message.displayed',
    clicked: 'message.clicked',
    cta_clicked: 'message.clicked',
    dismissed: 'message.dismissed',
  };
  const eventType = eventMap[action];
  if (eventType) {
    dispatch(eventType as Parameters<typeof dispatch>[0], { messageId: id, customerId, action });
  }

  return NextResponse.json({ impression }, { status: 201 });
}
