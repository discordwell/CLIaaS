import { and, eq, gt, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { externalObjects, syncCursors, tickets, tags, ticketTags } from '@/db/schema';
import { zendeskFetch, type ZendeskAuth } from './api';
import { ensureZendeskContext } from './ingest';

export interface ZendeskOutboundResult {
  updated: number;
  skipped: number;
  lastCursor?: string;
}

function getAuthFromEnv(): ZendeskAuth {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const email = process.env.ZENDESK_EMAIL;
  const token = process.env.ZENDESK_TOKEN;
  if (!subdomain || !email || !token) {
    throw new Error('Missing Zendesk credentials (ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_TOKEN)');
  }
  return { subdomain, email, token };
}

function mapStatusToZendesk(status: string | null): string | undefined {
  if (!status) return undefined;
  const map: Record<string, string> = {
    open: 'open',
    pending: 'pending',
    on_hold: 'hold',
    solved: 'solved',
    closed: 'closed',
  };
  return map[status] ?? 'open';
}

function mapPriorityToZendesk(priority: string | null): string | undefined {
  if (!priority) return undefined;
  const map: Record<string, string> = {
    low: 'low',
    normal: 'normal',
    high: 'high',
    urgent: 'urgent',
  };
  return map[priority] ?? 'normal';
}

async function getOutboundCursor(integrationId: string): Promise<string | null> {
  const rows = await db
    .select({ cursor: syncCursors.cursor })
    .from(syncCursors)
    .where(and(eq(syncCursors.integrationId, integrationId), eq(syncCursors.objectType, 'zendesk_outbound_ticket_updated_at')))
    .limit(1);
  return rows[0]?.cursor ?? null;
}

async function setOutboundCursor(integrationId: string, cursor: string): Promise<void> {
  await db
    .insert(syncCursors)
    .values({ integrationId, objectType: 'zendesk_outbound_ticket_updated_at', cursor, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [syncCursors.integrationId, syncCursors.objectType],
      set: { cursor, updatedAt: new Date() },
    });
}

export async function pushZendeskOutboundTickets(opts: {
  tenant: string;
  workspace: string;
  auth?: ZendeskAuth;
}): Promise<ZendeskOutboundResult> {
  const auth = opts.auth ?? getAuthFromEnv();
  const { workspaceId, integrationId } = await ensureZendeskContext({ tenant: opts.tenant, workspace: opts.workspace });

  const lastCursor = await getOutboundCursor(integrationId);
  const lastCursorDate = lastCursor ? new Date(lastCursor) : null;

  const where = [eq(tickets.workspaceId, workspaceId), eq(tickets.source, 'zendesk')];
  if (lastCursorDate) {
    where.push(gt(tickets.updatedAt, lastCursorDate));
  }

  const rows = await db
    .select({
      id: tickets.id,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      assigneeId: tickets.assigneeId,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .where(and(...where));

  if (rows.length === 0) {
    return { updated: 0, skipped: 0, lastCursor: lastCursor ?? undefined };
  }

  const ticketIds = rows.map(row => row.id);
  const externalTicketRows = await db
    .select({ internalId: externalObjects.internalId, externalId: externalObjects.externalId })
    .from(externalObjects)
    .where(
      and(
        eq(externalObjects.integrationId, integrationId),
        eq(externalObjects.objectType, 'ticket'),
        inArray(externalObjects.internalId, ticketIds),
      ),
    );
  const externalTicketIdByInternal = new Map<string, string>();
  for (const row of externalTicketRows) {
    if (row.externalId) externalTicketIdByInternal.set(row.internalId, row.externalId);
  }

  const assigneeIds = rows.map(row => row.assigneeId).filter((id): id is string => Boolean(id));
  const externalUserRows = assigneeIds.length
    ? await db
        .select({ internalId: externalObjects.internalId, externalId: externalObjects.externalId })
        .from(externalObjects)
        .where(
          and(
            eq(externalObjects.integrationId, integrationId),
            eq(externalObjects.objectType, 'user'),
            inArray(externalObjects.internalId, assigneeIds),
          ),
        )
    : [];
  const externalUserIdByInternal = new Map<string, string>();
  for (const row of externalUserRows) {
    if (row.externalId) externalUserIdByInternal.set(row.internalId, row.externalId);
  }

  const tagRows = await db
    .select({ ticketId: ticketTags.ticketId, name: tags.name })
    .from(ticketTags)
    .innerJoin(tags, eq(tags.id, ticketTags.tagId))
    .where(inArray(ticketTags.ticketId, ticketIds));
  const tagsByTicket = new Map<string, string[]>();
  for (const row of tagRows) {
    const existing = tagsByTicket.get(row.ticketId) ?? [];
    existing.push(row.name);
    tagsByTicket.set(row.ticketId, existing);
  }

  let updated = 0;
  let skipped = 0;
  let maxUpdatedAt = lastCursorDate ?? new Date(0);

  for (const row of rows) {
    const externalId = externalTicketIdByInternal.get(row.id);
    if (!externalId) {
      skipped++;
      continue;
    }

    const update: Record<string, unknown> = {
      subject: row.subject,
      status: mapStatusToZendesk(row.status),
      priority: mapPriorityToZendesk(row.priority),
      tags: tagsByTicket.get(row.id) ?? [],
    };

    const assigneeExternal = row.assigneeId ? externalUserIdByInternal.get(row.assigneeId) : undefined;
    if (assigneeExternal) update.assignee_id = parseInt(assigneeExternal, 10);

    await zendeskFetch(auth, `/api/v2/tickets/${externalId}.json`, {
      method: 'PUT',
      body: { ticket: update },
    });

    updated++;
    if (row.updatedAt > maxUpdatedAt) maxUpdatedAt = row.updatedAt;
  }

  if (updated > 0) {
    await setOutboundCursor(integrationId, maxUpdatedAt.toISOString());
  }

  return { updated, skipped, lastCursor: maxUpdatedAt.toISOString() };
}
