import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { messageCreated } from '@/lib/events';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireScope(request, 'tickets:write');
  if ('error' in authResult) return authResult.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{ body: string; mentions?: string[] }>(request);
  if ('error' in parsed) return parsed.error;
  const { body, mentions } = parsed.data;

  if (!body?.trim()) {
    return NextResponse.json({ error: 'Note body is required' }, { status: 400 });
  }

  // Try DB path
  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq } = await import('drizzle-orm');

      // Verify ticket exists
      const ticketRows = await db
        .select({ id: schema.tickets.id, workspaceId: schema.tickets.workspaceId })
        .from(schema.tickets)
        .where(eq(schema.tickets.id, id))
        .limit(1);

      if (ticketRows.length === 0) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }

      // Find or create conversation
      const convRows = await db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.ticketId, id))
        .limit(1);

      let conversationId = convRows[0]?.id;
      if (!conversationId) {
        const [convRow] = await db
          .insert(schema.conversations)
          .values({
            ticketId: id,
            workspaceId: ticketRows[0].workspaceId,
            channelType: 'email',
            startedAt: new Date(),
            lastActivityAt: new Date(),
          })
          .returning({ id: schema.conversations.id });
        conversationId = convRow.id;
      }

      // Insert internal note
      const authorId = authResult.user?.id ?? null;
      const [row] = await db
        .insert(schema.messages)
        .values({
          conversationId,
          workspaceId: ticketRows[0].workspaceId,
          authorType: 'user' as const,
          authorId,
          body: body.trim(),
          visibility: 'internal' as const,
          mentionedUserIds: mentions?.length ? mentions : null,
        })
        .returning({ id: schema.messages.id, createdAt: schema.messages.createdAt });

      // Update ticket's updatedAt
      await db
        .update(schema.tickets)
        .set({ updatedAt: new Date() })
        .where(eq(schema.tickets.id, id));

      // Fire event with isNote flag — dispatcher will skip email/AI for internal notes
      messageCreated({
        ticketId: id,
        messageId: row.id,
        visibility: 'internal',
        isNote: true,
        mentions: mentions ?? [],
      });

      // Dispatch mention notifications if there are mentions
      if (mentions?.length) {
        try {
          const { extractMentions, resolveMentions } = await import('@/lib/mentions');
          const { dispatchMentionNotifications } = await import('@/lib/notifications');
          const allMentionStrings = extractMentions(body);
          // Combine explicit mention IDs with parsed @mentions
          const resolvedUsers = await resolveMentions(allMentionStrings, ticketRows[0].workspaceId);
          const allMentionIds = [...new Set([...mentions, ...resolvedUsers.map(u => u.id)])];
          if (allMentionIds.length > 0) {
            void dispatchMentionNotifications({
              messageId: row.id,
              ticketId: id,
              mentionedUserIds: allMentionIds,
              authorName: authResult.user?.name ?? authResult.user?.email ?? 'Agent',
              notePreview: body.trim().slice(0, 200),
              workspaceId: ticketRows[0].workspaceId,
            });
          }
        } catch {
          // Mention dispatch is best-effort
        }
      }

      return NextResponse.json({
        message: {
          id: row.id,
          body: body.trim(),
          createdAt: row.createdAt.toISOString(),
        },
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to create note' },
        { status: 500 },
      );
    }
  }

  // JSONL/demo fallback — notes are ephemeral without DB
  const noteId = `note-${Date.now()}`;
  messageCreated({
    ticketId: id,
    messageId: noteId,
    visibility: 'internal',
    isNote: true,
  });

  return NextResponse.json({
    message: {
      id: noteId,
      body: body.trim(),
      createdAt: new Date().toISOString(),
    },
  });
}
