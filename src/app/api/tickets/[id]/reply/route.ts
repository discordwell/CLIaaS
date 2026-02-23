import { NextResponse } from 'next/server';
import { resolveSource, extractExternalId } from '@/lib/connector-service';
import { getAuth } from '@/lib/connector-auth';
import { zendeskPostComment } from '@cli/connectors/zendesk';
import { helpcrunchPostMessage } from '@cli/connectors/helpcrunch';
import { freshdeskReply, freshdeskAddNote } from '@cli/connectors/freshdesk';
import { groovePostMessage } from '@cli/connectors/groove';
import { messageCreated } from '@/lib/events';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const { message, isNote } = body as { message: string; isNote?: boolean };

  if (!message?.trim()) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  const source = resolveSource(id);
  if (!source) {
    return NextResponse.json({ error: 'Cannot determine source from ticket ID' }, { status: 400 });
  }

  const auth = getAuth(source);
  if (!auth) {
    return NextResponse.json({ error: `${source} not configured` }, { status: 400 });
  }

  const externalId = extractExternalId(id);
  const numericId = parseInt(externalId, 10);
  if (isNaN(numericId)) {
    return NextResponse.json({ error: 'Invalid ticket ID format' }, { status: 400 });
  }

  try {
    switch (source) {
      case 'zendesk':
        await zendeskPostComment(
          auth as Parameters<typeof zendeskPostComment>[0],
          numericId,
          message,
          !isNote,
        );
        break;
      case 'helpcrunch':
        await helpcrunchPostMessage(
          auth as Parameters<typeof helpcrunchPostMessage>[0],
          numericId,
          message,
        );
        break;
      case 'freshdesk':
        if (isNote) {
          await freshdeskAddNote(
            auth as Parameters<typeof freshdeskAddNote>[0],
            numericId,
            message,
          );
        } else {
          await freshdeskReply(
            auth as Parameters<typeof freshdeskReply>[0],
            numericId,
            message,
          );
        }
        break;
      case 'groove':
        await groovePostMessage(
          auth as Parameters<typeof groovePostMessage>[0],
          numericId,
          message,
          !!isNote,
        );
        break;
    }

    messageCreated({ ticketId: id, source, isNote: !!isNote });
    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Reply failed' },
      { status: 500 },
    );
  }
}
