import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requirePerm(request, 'tickets:reply_internal');
  if ('error' in authResult) return authResult.error;

  const { id } = await params;

  try {
    const { listSideConversations } = await import('@/lib/side-conversations');
    const conversations = await listSideConversations(id);
    return NextResponse.json({ conversations });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list side conversations' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requirePerm(request, 'tickets:reply_internal');
  if ('error' in authResult) return authResult.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{
    subject: string;
    body: string;
    externalEmail?: string;
    sendEmail?: boolean;
  }>(request);
  if ('error' in parsed) return parsed.error;
  const { subject, body, externalEmail, sendEmail: shouldSendEmail } = parsed.data;

  if (!subject?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 });
  }

  try {
    const { createSideConversation } = await import('@/lib/side-conversations');
    const { dispatch } = await import('@/lib/events');

    const authorId = authResult.user?.id ?? 'unknown';
    const workspaceId = authResult.user?.workspaceId ?? '';

    const result = await createSideConversation({
      ticketId: id,
      subject: subject.trim(),
      externalEmail: externalEmail?.trim(),
      body: body.trim(),
      authorId,
      workspaceId,
      sendEmail: shouldSendEmail,
    });

    dispatch('message.created', {
      ticketId: id,
      conversationId: result.conversationId,
      isSideConversation: true,
      visibility: 'internal',
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create side conversation' },
      { status: 500 },
    );
  }
}
