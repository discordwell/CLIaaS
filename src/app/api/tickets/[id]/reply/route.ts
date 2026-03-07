import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveSource, extractExternalId } from '@/lib/connector-service';
import { getAuth } from '@/lib/connector-auth';
import { zendeskPostComment } from '@cli/connectors/zendesk';
import { helpcrunchPostMessage } from '@cli/connectors/helpcrunch';
import { freshdeskReply, freshdeskAddNote } from '@cli/connectors/freshdesk';
import { groovePostMessage } from '@cli/connectors/groove';
import { messageCreated } from '@/lib/events';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requirePerm(request, 'tickets:reply_public');
  if ('error' in authResult) return authResult.error;

  // Light agents cannot send public replies
  if (authResult.user.role === 'light_agent') {
    return NextResponse.json({ error: 'Light agents cannot send public replies' }, { status: 403 });
  }

  const { id } = await params;
  const parsed = await parseJsonBody<{ message: string; isNote?: boolean; mentionedUserIds?: string[] }>(request);
  if ('error' in parsed) return parsed.error;
  const { message, isNote, mentionedUserIds } = parsed.data;

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

    // Persist message in DB if available
    let messageId: string | undefined;
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        // Find ticket + workspace (scoped to user's workspace)
        const { and } = await import('drizzle-orm');
        const [ticketRow] = await db.select({ id: schema.tickets.id, workspaceId: schema.tickets.workspaceId })
          .from(schema.tickets).where(and(eq(schema.tickets.id, id), eq(schema.tickets.workspaceId, authResult.user.workspaceId))).limit(1);

        if (ticketRow) {
          // Find or create conversation
          const convRows = await db.select({ id: schema.conversations.id })
            .from(schema.conversations).where(eq(schema.conversations.ticketId, id)).limit(1);

          let conversationId = convRows[0]?.id;
          if (!conversationId) {
            const [convRow] = await db.insert(schema.conversations).values({
              ticketId: id,
              workspaceId: ticketRow.workspaceId,
              channelType: 'email',
              startedAt: new Date(),
              lastActivityAt: new Date(),
            }).returning({ id: schema.conversations.id });
            conversationId = convRow.id;
          }

          // Insert message
          const authorId = authResult.user?.id ?? null;
          const [row] = await db.insert(schema.messages).values({
            conversationId,
            workspaceId: ticketRow.workspaceId,
            authorType: 'user' as const,
            authorId,
            body: message.trim(),
            visibility: isNote ? ('internal' as const) : ('public' as const),
            mentionedUserIds: mentionedUserIds?.length ? mentionedUserIds : null,
          }).returning({ id: schema.messages.id });

          messageId = row.id;

          // Update ticket's updatedAt
          await db.update(schema.tickets).set({ updatedAt: new Date() }).where(eq(schema.tickets.id, id));

          // Dispatch mention notifications if mentionedUserIds provided
          if (mentionedUserIds?.length && messageId) {
            try {
              const { extractMentions, resolveMentions } = await import('@/lib/mentions');
              const { dispatchMentionNotifications } = await import('@/lib/notifications');
              const parsedMentions = extractMentions(message);
              const resolvedUsers = await resolveMentions(parsedMentions, ticketRow.workspaceId);
              const allMentionIds = [...new Set([...mentionedUserIds, ...resolvedUsers.map(u => u.id)])];
              if (allMentionIds.length > 0) {
                void dispatchMentionNotifications({
                  messageId,
                  ticketId: id,
                  mentionedUserIds: allMentionIds,
                  authorName: authResult.user?.name ?? authResult.user?.email ?? 'Agent',
                  notePreview: message.trim().slice(0, 200),
                  workspaceId: ticketRow.workspaceId,
                });
              }
            } catch {
              // Mention dispatch is best-effort
            }
          }
        }
      } catch {
        // DB persistence is best-effort for connector-based replies
      }
    }

    messageCreated({
      ticketId: id,
      source,
      messageId,
      isNote: !!isNote,
      visibility: isNote ? 'internal' : 'public',
      mentions: mentionedUserIds ?? [],
    });
    return NextResponse.json({ status: 'ok', messageId });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Reply failed') },
      { status: 500 },
    );
  }
}
