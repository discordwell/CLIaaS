import { loadTickets, computeStats } from "@/lib/data";
import TicketInbox from "@/components/TicketInbox";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const tickets = await loadTickets();
  const stats = computeStats(tickets);

  // Default sort: newest first
  tickets.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <TicketInbox
      tickets={tickets.map((t) => ({
        id: t.id,
        externalId: t.externalId,
        subject: t.subject,
        source: t.source,
        status: t.status,
        priority: t.priority,
        assignee: t.assignee,
        requester: t.requester,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        tags: t.tags,
        mergedIntoTicketId: t.mergedIntoTicketId,
      }))}
      stats={{
        total: stats.total,
        byStatus: stats.byStatus,
        byPriority: stats.byPriority,
      }}
    />
  );
}
