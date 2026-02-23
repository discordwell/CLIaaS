/**
 * Shared builder for constructing ticket-like objects from raw event data.
 * Used by both the automation executor (TicketContext) and resolution pipeline (Ticket).
 */

export interface BaseTicketFields {
  id: string;
  subject: string;
  status: string;
  priority: string;
  assignee: string | null;
  requester: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function buildBaseTicketFromEvent(data: Record<string, unknown>): BaseTicketFields {
  return {
    id: String(data.ticketId ?? data.id ?? ''),
    subject: String(data.subject ?? ''),
    status: String(data.status ?? 'open'),
    priority: String(data.priority ?? 'normal'),
    assignee: data.assignee != null ? String(data.assignee) : null,
    requester: String(data.requester ?? ''),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    createdAt: String(data.createdAt ?? new Date().toISOString()),
    updatedAt: String(data.updatedAt ?? new Date().toISOString()),
  };
}
