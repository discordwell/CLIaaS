import { NextResponse } from "next/server";
import { loadTickets, loadMessages } from "@/lib/data";

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
