import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getMessages, createMessage } from '@/lib/messages/message-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const messages = await getMessages(auth.user.workspaceId);
  return NextResponse.json({ messages, total: messages.length });
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'tickets:reply_public');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name: string;
    messageType: 'banner' | 'modal' | 'tooltip' | 'slide_in';
    title: string;
    body?: string;
    ctaText?: string;
    ctaUrl?: string;
    targetUrlPattern?: string;
    segmentQuery?: Record<string, unknown>;
    priority?: number;
    startAt?: string;
    endAt?: string;
    maxImpressions?: number;
  }>(request);
  if ('error' in parsed) return parsed.error;

  if (!parsed.data.name || !parsed.data.messageType || !parsed.data.title) {
    return NextResponse.json({ error: 'name, messageType, and title are required' }, { status: 400 });
  }

  const message = createMessage(
    { ...parsed.data, createdBy: auth.user.id },
    auth.user.workspaceId,
  );

  return NextResponse.json({ message }, { status: 201 });
}
