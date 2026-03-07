import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { loadTickets, loadMessages } from "@/lib/data";
import { resolveSource, extractExternalId } from "@/lib/connector-service";
import { getAuth } from "@/lib/connector-auth";
import { zendeskUpdateTicket } from "@cli/connectors/zendesk";
import { helpcrunchUpdateChat } from "@cli/connectors/helpcrunch";
import { freshdeskUpdateTicket } from "@cli/connectors/freshdesk";
import { grooveUpdateTicket } from "@cli/connectors/groove";
import { ticketUpdated, ticketResolved } from "@/lib/events";
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';
import { canCollaboratorAccessTicket } from '@/lib/rbac/collaborator-scope';

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requirePerm(request, 'tickets:view');
  if ('error' in authResult) return authResult.error;

  const { id } = await params;

  // Collaborator scoping
  if (authResult.user.role === 'collaborator') {
    const allowed = await canCollaboratorAccessTicket(authResult.user.id, id, authResult.user.workspaceId);
    if (!allowed) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }
  }

  const tickets = await loadTickets();
  const ticket = tickets.find((t) => t.id === id || t.externalId === id);

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  const messages = await loadMessages(ticket.id);
  messages.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return NextResponse.json({ ticket, messages });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requirePerm(request, 'tickets:update_status');
  if ('error' in authResult) return authResult.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{
    status?: string;
    priority?: string;
    addTags?: string[];
    removeTags?: string[];
  }>(request);
  if ('error' in parsed) return parsed.error;
  const { status, priority, addTags, removeTags } = parsed.data;

  const VALID_STATUSES = ['open', 'pending', 'on_hold', 'solved', 'closed'];
  const VALID_PRIORITIES = ['urgent', 'high', 'normal', 'low'];

  if (!status && !priority && !addTags?.length && !removeTags?.length) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
  }
  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return NextResponse.json({ error: `Invalid priority: ${priority}` }, { status: 400 });
  }

  // Try DataProvider path first (works for DB mode and JSONL mode)
  try {
    const { updateTicket } = await import("@/lib/data");
    await updateTicket(id, { status, priority, addTags, removeTags });

    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (priority) updates.priority = priority;
    if (addTags?.length) updates.addTags = addTags;
    if (removeTags?.length) updates.removeTags = removeTags;

    ticketUpdated({ ticketId: id, ...updates });
    if (status === 'solved' || status === 'closed') {
      ticketResolved({ ticketId: id, status: status as string });
    }
    return NextResponse.json({ status: 'ok', updated: updates });
  } catch {
    // DataProvider not available — fall through to connector path
  }

  // Connector-based path (external platforms)
  const source = resolveSource(id);
  if (!source) {
    return NextResponse.json({ error: "Cannot determine source from ticket ID" }, { status: 400 });
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
    const updates: Record<string, string> = {};
    if (status) updates.status = status;
    if (priority) updates.priority = priority;

    switch (source) {
      case 'zendesk':
        await zendeskUpdateTicket(
          auth as Parameters<typeof zendeskUpdateTicket>[0],
          numericId,
          updates,
        );
        break;
      case 'helpcrunch':
        await helpcrunchUpdateChat(
          auth as Parameters<typeof helpcrunchUpdateChat>[0],
          numericId,
          updates,
        );
        break;
      case 'freshdesk':
        await freshdeskUpdateTicket(
          auth as Parameters<typeof freshdeskUpdateTicket>[0],
          numericId,
          updates,
        );
        break;
      case 'groove':
        await grooveUpdateTicket(
          auth as Parameters<typeof grooveUpdateTicket>[0],
          numericId,
          updates,
        );
        break;
    }

    ticketUpdated({ ticketId: id, ...updates });
    if (status === 'solved' || status === 'closed') {
      ticketResolved({ ticketId: id, status });
    }
    return NextResponse.json({ status: 'ok', updated: updates });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Update failed') },
      { status: 500 },
    );
  }
}
