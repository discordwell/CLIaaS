import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; scId: string }> },
) {
  const authResult = await requireScope(request, 'tickets:write');
  if ('error' in authResult) return authResult.error;

  const { id, scId } = await params;
  const parsed = await parseJsonBody<{ body: string; sendEmail?: boolean }>(request);
  if ('error' in parsed) return parsed.error;
  const { body, sendEmail: shouldSendEmail } = parsed.data;

  if (!body?.trim()) {
    return NextResponse.json({ error: 'Reply body is required' }, { status: 400 });
  }

  try {
    const { replySideConversation } = await import('@/lib/side-conversations');
    const { dispatch } = await import('@/lib/events');

    const authorId = authResult.user?.id ?? 'unknown';

    const result = await replySideConversation({
      conversationId: scId,
      body: body.trim(),
      authorId,
      sendEmail: shouldSendEmail,
    });

    dispatch('message.created', {
      ticketId: id,
      conversationId: scId,
      messageId: result.messageId,
      isSideConversation: true,
      visibility: 'internal',
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to reply to side conversation' },
      { status: 500 },
    );
  }
}
