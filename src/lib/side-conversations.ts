/**
 * Side conversations — multiple conversation threads per ticket.
 * Each side conversation has its own subject, optional external email, and message thread.
 */

import { createLogger } from './logger';

const logger = createLogger('side-conversations');

export interface SideConversation {
  id: string;
  ticketId: string;
  subject: string | null;
  externalEmail: string | null;
  status: 'open' | 'closed';
  createdById: string | null;
  createdAt: string;
  messageCount: number;
}

export interface SideConversationDetail extends SideConversation {
  messages: Array<{
    id: string;
    author: string;
    authorType: string;
    body: string;
    createdAt: string;
  }>;
}

export async function createSideConversation(params: {
  ticketId: string;
  subject: string;
  externalEmail?: string;
  body: string;
  authorId: string;
  workspaceId: string;
  sendEmail?: boolean;
}): Promise<{ conversationId: string; messageId: string }> {
  const { db } = await import('@/db');
  const schema = await import('@/db/schema');

  // Create conversation + first message in a transaction
  const { conv, msg } = await db.transaction(async (tx) => {
    const [convRow] = await tx
      .insert(schema.conversations)
      .values({
        ticketId: params.ticketId,
        workspaceId: params.workspaceId,
        channelType: 'email',
        kind: 'side' as const,
        subject: params.subject,
        externalEmail: params.externalEmail ?? null,
        createdById: params.authorId,
        status: 'open' as const,
        startedAt: new Date(),
        lastActivityAt: new Date(),
      })
      .returning({ id: schema.conversations.id });

    const [msgRow] = await tx
      .insert(schema.messages)
      .values({
        conversationId: convRow.id,
        workspaceId: params.workspaceId,
        authorType: 'user' as const,
        authorId: params.authorId,
        body: params.body,
        visibility: 'internal' as const,
      })
      .returning({ id: schema.messages.id });

    return { conv: convRow, msg: msgRow };
  });

  // Send email if requested and external email provided
  if (params.sendEmail && params.externalEmail) {
    try {
      const { sendEmail } = await import('./email/sender');
      const domain = process.env.NEXT_PUBLIC_BASE_URL?.replace(/https?:\/\//, '') || 'cliaas.com';
      const threadId = `<sc-${conv.id}@${domain}>`;

      // Escape HTML to prevent injection
      const escapeHtml = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      await sendEmail({
        to: params.externalEmail,
        subject: params.subject,
        text: params.body,
        html: `<div>${escapeHtml(params.body).replace(/\n/g, '<br>')}</div>`,
        inReplyTo: threadId,
        references: threadId,
      });
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : 'Unknown' }, 'Failed to send side conversation email');
    }
  }

  return { conversationId: conv.id, messageId: msg.id };
}

export async function replySideConversation(params: {
  conversationId: string;
  body: string;
  authorId: string;
  sendEmail?: boolean;
}): Promise<{ messageId: string }> {
  const { db } = await import('@/db');
  const schema = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  // Get the conversation
  const [conv] = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, params.conversationId))
    .limit(1);

  if (!conv) throw new Error('Side conversation not found');
  if (conv.kind !== 'side') throw new Error('Not a side conversation');

  // Add message
  const [msg] = await db
    .insert(schema.messages)
    .values({
      conversationId: params.conversationId,
      workspaceId: conv.workspaceId,
      authorType: 'user' as const,
      authorId: params.authorId,
      body: params.body,
      visibility: 'internal' as const,
    })
    .returning({ id: schema.messages.id });

  // Update last activity
  await db
    .update(schema.conversations)
    .set({ lastActivityAt: new Date() })
    .where(eq(schema.conversations.id, params.conversationId));

  // Send email if requested
  if (params.sendEmail && conv.externalEmail) {
    try {
      const { sendEmail } = await import('./email/sender');
      const domain = process.env.NEXT_PUBLIC_BASE_URL?.replace(/https?:\/\//, '') || 'cliaas.com';
      const threadId = `<sc-${conv.id}@${domain}>`;

      const escapeHtml = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      await sendEmail({
        to: conv.externalEmail,
        subject: conv.subject ? `Re: ${conv.subject}` : 'Re: Side conversation',
        text: params.body,
        html: `<div>${escapeHtml(params.body).replace(/\n/g, '<br>')}</div>`,
        inReplyTo: threadId,
        references: threadId,
      });
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : 'Unknown' }, 'Failed to send side conversation reply email');
    }
  }

  return { messageId: msg.id };
}

export async function listSideConversations(ticketId: string): Promise<SideConversation[]> {
  const { db } = await import('@/db');
  const schema = await import('@/db/schema');
  const { eq, and, sql } = await import('drizzle-orm');

  const rows = await db
    .select({
      id: schema.conversations.id,
      ticketId: schema.conversations.ticketId,
      subject: schema.conversations.subject,
      externalEmail: schema.conversations.externalEmail,
      status: schema.conversations.status,
      createdById: schema.conversations.createdById,
      createdAt: schema.conversations.startedAt,
      messageCount: sql<number>`(SELECT count(*) FROM messages WHERE conversation_id = ${schema.conversations.id})::int`,
    })
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.ticketId, ticketId),
        eq(schema.conversations.kind, 'side'),
      ),
    )
    .orderBy(schema.conversations.startedAt);

  return rows.map((r) => ({
    id: r.id,
    ticketId: r.ticketId,
    subject: r.subject,
    externalEmail: r.externalEmail,
    status: r.status as 'open' | 'closed',
    createdById: r.createdById,
    createdAt: r.createdAt.toISOString(),
    messageCount: r.messageCount,
  }));
}

export async function getSideConversation(conversationId: string): Promise<SideConversationDetail | null> {
  const { db } = await import('@/db');
  const schema = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const [conv] = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId))
    .limit(1);

  if (!conv || conv.kind !== 'side') return null;

  const messageRows = await db
    .select({
      id: schema.messages.id,
      authorType: schema.messages.authorType,
      authorId: schema.messages.authorId,
      body: schema.messages.body,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(schema.messages.createdAt);

  return {
    id: conv.id,
    ticketId: conv.ticketId,
    subject: conv.subject,
    externalEmail: conv.externalEmail,
    status: conv.status as 'open' | 'closed',
    createdById: conv.createdById,
    createdAt: conv.startedAt.toISOString(),
    messageCount: messageRows.length,
    messages: messageRows.map((m) => ({
      id: m.id,
      author: m.authorId ?? m.authorType,
      authorType: m.authorType,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function closeSideConversation(conversationId: string): Promise<void> {
  const { db } = await import('@/db');
  const schema = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  await db
    .update(schema.conversations)
    .set({ status: 'closed' as const })
    .where(eq(schema.conversations.id, conversationId));
}

export async function reopenSideConversation(conversationId: string): Promise<void> {
  const { db } = await import('@/db');
  const schema = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  await db
    .update(schema.conversations)
    .set({ status: 'open' as const })
    .where(eq(schema.conversations.id, conversationId));
}
