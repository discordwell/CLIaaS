/**
 * Core business logic for ticket merge & split operations.
 * All functions operate within DB transactions via the passed db/schema context.
 */

import { eq, and, inArray } from 'drizzle-orm';
import type {
  TicketMergeParams,
  TicketMergeResult,
  TicketSplitParams,
  TicketSplitResult,
  TicketUnmergeParams,
  MergeHistoryEntry,
} from '@/lib/data-provider/types';

type DbContext = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  schema: typeof import('@/db/schema');
  workspaceId: string;
};

export async function mergeTickets(
  ctx: DbContext,
  params: TicketMergeParams,
): Promise<TicketMergeResult> {
  const { db, schema, workspaceId } = ctx;
  const { primaryTicketId, mergedTicketIds, mergedBy } = params;

  if (mergedTicketIds.includes(primaryTicketId)) {
    throw new Error('Cannot merge a ticket with itself.');
  }
  if (mergedTicketIds.length === 0) {
    throw new Error('At least one ticket to merge is required.');
  }

  const allIds = [primaryTicketId, ...mergedTicketIds];
  const ticketRows = await db
    .select()
    .from(schema.tickets)
    .where(and(
      eq(schema.tickets.workspaceId, workspaceId),
      inArray(schema.tickets.id, allIds),
    ));

  if (ticketRows.length !== allIds.length) {
    throw new Error('One or more tickets not found in this workspace.');
  }

  const primaryTicket = ticketRows.find((t: { id: string }) => t.id === primaryTicketId);
  if (!primaryTicket) throw new Error('Primary ticket not found.');

  // Check none of the merged tickets are already merged
  for (const t of ticketRows) {
    if (t.id !== primaryTicketId && t.mergedIntoTicketId) {
      throw new Error(`Ticket ${t.id} is already merged into another ticket.`);
    }
  }

  // Get the primary ticket's conversation
  const [primaryConv] = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(eq(schema.conversations.ticketId, primaryTicketId))
    .limit(1);

  if (!primaryConv) throw new Error('Primary ticket has no conversation.');

  const mergeLogIds: string[] = [];
  let totalMovedMessages = 0;
  const allMergedTags: Set<string> = new Set();

  for (const mergedId of mergedTicketIds) {
    const mergedTicket = ticketRows.find((t: { id: string }) => t.id === mergedId);

    // Get the merged ticket's conversation
    const [mergedConv] = await db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.ticketId, mergedId))
      .limit(1);

    // Find messages to move
    let movedMessageIds: string[] = [];
    if (mergedConv) {
      const messagesToMove = await db
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, mergedConv.id));

      movedMessageIds = messagesToMove.map((m: { id: string }) => m.id);

      // Move messages to primary conversation
      if (movedMessageIds.length > 0) {
        await db
          .update(schema.messages)
          .set({ conversationId: primaryConv.id })
          .where(inArray(schema.messages.id, movedMessageIds));
      }
    }

    totalMovedMessages += movedMessageIds.length;

    // Union tags
    const mergedTags: string[] = mergedTicket.tags ?? [];
    for (const tag of mergedTags) {
      allMergedTags.add(tag);
    }

    // Snapshot the merged ticket before closing
    const snapshot = {
      id: mergedTicket.id,
      subject: mergedTicket.subject,
      status: mergedTicket.status,
      priority: mergedTicket.priority,
      tags: mergedTicket.tags,
      assigneeId: mergedTicket.assigneeId,
      requesterId: mergedTicket.requesterId,
      description: mergedTicket.description,
    };

    // Close the merged ticket and set merged_into
    await db
      .update(schema.tickets)
      .set({
        mergedIntoTicketId: primaryTicketId,
        status: 'closed',
        updatedAt: new Date(),
      })
      .where(eq(schema.tickets.id, mergedId));

    // Write merge log
    const [logRow] = await db
      .insert(schema.ticketMergeLog)
      .values({
        workspaceId,
        primaryTicketId,
        mergedTicketId: mergedId,
        mergedBy: mergedBy ?? null,
        mergedTicketSnapshot: snapshot,
        movedMessageIds,
        movedAttachmentIds: [],
        mergedTags,
      })
      .returning({ id: schema.ticketMergeLog.id });

    mergeLogIds.push(logRow.id);

    // Add system message to primary ticket
    await db.insert(schema.messages).values({
      conversationId: primaryConv.id,
      authorType: 'system',
      body: `Ticket #${mergedTicket.subject} was merged into this ticket. ${movedMessageIds.length} message(s) moved.`,
      visibility: 'public',
      createdAt: new Date(),
    });
  }

  // Update primary ticket tags (union)
  const primaryTags: string[] = primaryTicket.tags ?? [];
  const uniqueTags = [...new Set([...primaryTags, ...allMergedTags])];
  await db
    .update(schema.tickets)
    .set({ tags: uniqueTags, updatedAt: new Date() })
    .where(eq(schema.tickets.id, primaryTicketId));

  return {
    primaryTicketId,
    mergedCount: mergedTicketIds.length,
    movedMessageCount: totalMovedMessages,
    mergedTags: [...allMergedTags],
    mergeLogIds,
  };
}

export async function splitTicket(
  ctx: DbContext,
  params: TicketSplitParams,
): Promise<TicketSplitResult> {
  const { db, schema, workspaceId } = ctx;
  const { ticketId, messageIds, newSubject, splitBy } = params;

  if (messageIds.length === 0) {
    throw new Error('At least one message must be selected for the split.');
  }

  // Load source ticket
  const [sourceTicket] = await db
    .select()
    .from(schema.tickets)
    .where(and(
      eq(schema.tickets.id, ticketId),
      eq(schema.tickets.workspaceId, workspaceId),
    ))
    .limit(1);

  if (!sourceTicket) throw new Error('Source ticket not found.');

  // Get source conversation
  const [sourceConv] = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(eq(schema.conversations.ticketId, ticketId))
    .limit(1);

  if (!sourceConv) throw new Error('Source ticket has no conversation.');

  // Validate messages belong to this conversation
  const sourceMessages = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, sourceConv.id));

  const sourceMessageIds = new Set(sourceMessages.map((m: { id: string }) => m.id));
  for (const msgId of messageIds) {
    if (!sourceMessageIds.has(msgId)) {
      throw new Error(`Message ${msgId} does not belong to ticket ${ticketId}.`);
    }
  }

  // Must leave at least one message in the source
  const remainingCount = sourceMessages.length - messageIds.length;
  if (remainingCount < 1) {
    throw new Error('At least one message must remain in the source ticket.');
  }

  // Create new ticket
  const subject = newSubject ?? `Split from: ${sourceTicket.subject}`;
  const [newTicket] = await db
    .insert(schema.tickets)
    .values({
      workspaceId,
      tenantId: sourceTicket.tenantId,
      requesterId: sourceTicket.requesterId,
      subject,
      description: '',
      status: 'open',
      priority: sourceTicket.priority,
      source: sourceTicket.source,
      tags: sourceTicket.tags ?? [],
      splitFromTicketId: ticketId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: schema.tickets.id });

  // Create conversation for new ticket
  const [newConv] = await db
    .insert(schema.conversations)
    .values({
      ticketId: newTicket.id,
      workspaceId,
      channelType: 'email',
      startedAt: new Date(),
      lastActivityAt: new Date(),
    })
    .returning({ id: schema.conversations.id });

  // Move selected messages to new conversation
  await db
    .update(schema.messages)
    .set({ conversationId: newConv.id })
    .where(inArray(schema.messages.id, messageIds));

  // Write split log
  const [splitLog] = await db
    .insert(schema.ticketSplitLog)
    .values({
      workspaceId,
      sourceTicketId: ticketId,
      newTicketId: newTicket.id,
      splitBy: splitBy ?? null,
      movedMessageIds: messageIds,
    })
    .returning({ id: schema.ticketSplitLog.id });

  // Add system messages
  await db.insert(schema.messages).values({
    conversationId: sourceConv.id,
    authorType: 'system',
    body: `${messageIds.length} message(s) split into new ticket "${subject}".`,
    visibility: 'public',
    createdAt: new Date(),
  });

  await db.insert(schema.messages).values({
    conversationId: newConv.id,
    authorType: 'system',
    body: `This ticket was split from "${sourceTicket.subject}". ${messageIds.length} message(s) moved.`,
    visibility: 'public',
    createdAt: new Date(),
  });

  return {
    sourceTicketId: ticketId,
    newTicketId: newTicket.id,
    movedMessageCount: messageIds.length,
    splitLogId: splitLog.id,
  };
}

export async function unmergeTicket(
  ctx: DbContext,
  params: TicketUnmergeParams,
): Promise<void> {
  const { db, schema, workspaceId } = ctx;
  const { mergeLogId, unmergedBy } = params;

  // Load merge log entry
  const [logEntry] = await db
    .select()
    .from(schema.ticketMergeLog)
    .where(and(
      eq(schema.ticketMergeLog.id, mergeLogId),
      eq(schema.ticketMergeLog.workspaceId, workspaceId),
    ))
    .limit(1);

  if (!logEntry) throw new Error('Merge log entry not found.');
  if (logEntry.undone) throw new Error('This merge has already been undone.');

  // Check undo window
  const undoHours = parseInt(process.env.CLIAAS_MERGE_UNDO_HOURS ?? '24', 10);
  const mergedAt = new Date(logEntry.createdAt).getTime();
  const now = Date.now();
  if (now - mergedAt > undoHours * 60 * 60 * 1000) {
    throw new Error(`Undo window expired. Merges can only be undone within ${undoHours} hours.`);
  }

  const snapshot = logEntry.mergedTicketSnapshot as {
    id: string;
    subject: string;
    status: string;
    priority: string;
    tags: string[];
    assigneeId: string | null;
    requesterId: string | null;
    description: string | null;
  };

  // Get the merged ticket's conversation
  const [mergedConv] = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(eq(schema.conversations.ticketId, logEntry.mergedTicketId))
    .limit(1);

  if (!mergedConv) throw new Error('Merged ticket conversation not found.');

  // Move messages back
  const movedIds: string[] = logEntry.movedMessageIds ?? [];
  if (movedIds.length > 0) {
    await db
      .update(schema.messages)
      .set({ conversationId: mergedConv.id })
      .where(inArray(schema.messages.id, movedIds));
  }

  // Restore the merged ticket from snapshot
  await db
    .update(schema.tickets)
    .set({
      mergedIntoTicketId: null,
      status: snapshot.status,
      priority: snapshot.priority,
      tags: snapshot.tags,
      updatedAt: new Date(),
    })
    .where(eq(schema.tickets.id, logEntry.mergedTicketId));

  // Mark merge log as undone
  await db
    .update(schema.ticketMergeLog)
    .set({
      undone: true,
      undoneAt: new Date(),
      undoneBy: unmergedBy ?? null,
    })
    .where(eq(schema.ticketMergeLog.id, mergeLogId));

  // Add system message to primary
  const [primaryConv] = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(eq(schema.conversations.ticketId, logEntry.primaryTicketId))
    .limit(1);

  if (primaryConv) {
    await db.insert(schema.messages).values({
      conversationId: primaryConv.id,
      authorType: 'system',
      body: `Merge of ticket "${snapshot.subject}" was undone. ${movedIds.length} message(s) moved back.`,
      visibility: 'public',
      createdAt: new Date(),
    });
  }
}

export async function getMergeHistory(
  ctx: DbContext,
  ticketId: string,
): Promise<MergeHistoryEntry[]> {
  const { db, schema, workspaceId } = ctx;
  const entries: MergeHistoryEntry[] = [];

  // Get merge log entries where this ticket is primary or merged
  const mergeRows = await db
    .select()
    .from(schema.ticketMergeLog)
    .where(and(
      eq(schema.ticketMergeLog.workspaceId, workspaceId),
    ));

  for (const row of mergeRows) {
    if (row.primaryTicketId === ticketId || row.mergedTicketId === ticketId) {
      entries.push({
        id: row.id,
        type: 'merge',
        primaryTicketId: row.primaryTicketId,
        mergedTicketId: row.mergedTicketId,
        movedMessageIds: row.movedMessageIds ?? [],
        undone: row.undone,
        createdAt: new Date(row.createdAt).toISOString(),
      });
    }
  }

  // Get split log entries where this ticket is source or new
  const splitRows = await db
    .select()
    .from(schema.ticketSplitLog)
    .where(eq(schema.ticketSplitLog.workspaceId, workspaceId));

  for (const row of splitRows) {
    if (row.sourceTicketId === ticketId || row.newTicketId === ticketId) {
      entries.push({
        id: row.id,
        type: 'split',
        sourceTicketId: row.sourceTicketId,
        newTicketId: row.newTicketId,
        movedMessageIds: row.movedMessageIds ?? [],
        undone: false,
        createdAt: new Date(row.createdAt).toISOString(),
      });
    }
  }

  entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return entries;
}
