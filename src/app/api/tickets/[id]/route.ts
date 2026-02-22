import { NextResponse } from "next/server";
import { loadTickets, loadMessages } from "@/lib/data";
import { resolveSource, extractExternalId } from "@/lib/connector-service";
import { getAuth } from "@/lib/connector-auth";
import { zendeskUpdateTicket } from "@cli/connectors/zendesk";
import { helpcrunchUpdateChat } from "@cli/connectors/helpcrunch";
import { freshdeskUpdateTicket } from "@cli/connectors/freshdesk";
import { grooveUpdateTicket } from "@cli/connectors/groove";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { status, priority } = body as { status?: string; priority?: string };

  if (!status && !priority) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const source = resolveSource(id);
  if (!source) {
    return NextResponse.json({ error: "Cannot determine source from ticket ID" }, { status: 400 });
  }

  const auth = getAuth(source);
  if (!auth) {
    return NextResponse.json({ error: `${source} not configured` }, { status: 400 });
  }

  const externalId = extractExternalId(id);

  try {
    const updates: Record<string, string> = {};
    if (status) updates.status = status;
    if (priority) updates.priority = priority;

    switch (source) {
      case 'zendesk':
        await zendeskUpdateTicket(
          auth as Parameters<typeof zendeskUpdateTicket>[0],
          parseInt(externalId, 10),
          updates,
        );
        break;
      case 'helpcrunch':
        await helpcrunchUpdateChat(
          auth as Parameters<typeof helpcrunchUpdateChat>[0],
          parseInt(externalId, 10),
          updates,
        );
        break;
      case 'freshdesk':
        await freshdeskUpdateTicket(
          auth as Parameters<typeof freshdeskUpdateTicket>[0],
          parseInt(externalId, 10),
          updates,
        );
        break;
      case 'groove':
        await grooveUpdateTicket(
          auth as Parameters<typeof grooveUpdateTicket>[0],
          parseInt(externalId, 10),
          updates,
        );
        break;
    }

    return NextResponse.json({ status: 'ok', updated: updates });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Update failed' },
      { status: 500 },
    );
  }
}
