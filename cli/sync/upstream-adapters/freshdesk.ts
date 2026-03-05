import type {
  ConnectorWriteAdapter,
  UpstreamTicketUpdate,
  UpstreamTicketCreate,
  UpstreamReply,
  UpstreamNote,
  UpstreamCreateResult,
} from '../upstream-adapter.js';

/** Map CLIaaS status → Freshdesk numeric status codes. */
const STATUS_MAP: Record<string, number> = {
  open: 2,
  pending: 3,
  solved: 4,
  closed: 5,
};

/** Map CLIaaS priority → Freshdesk numeric priority codes. */
const PRIORITY_MAP: Record<string, number> = {
  low: 1,
  normal: 2, // Freshdesk calls this "medium"
  high: 3,
  urgent: 4,
};

export function createFreshdeskAdapter(auth: Record<string, string>): ConnectorWriteAdapter {
  const fdAuth = { subdomain: auth.domain, apiKey: auth.apiKey };

  return {
    name: 'freshdesk',
    supportsUpdate: true,
    supportsReply: true,

    async updateTicket(externalId: string, updates: UpstreamTicketUpdate): Promise<void> {
      const { freshdeskUpdateTicket } = await import('../../connectors/freshdesk.js');
      const mapped: Record<string, unknown> = {};
      if (updates.status) mapped.status = STATUS_MAP[updates.status] ?? 2;
      if (updates.priority) mapped.priority = PRIORITY_MAP[updates.priority] ?? 2;
      if (updates.tags) mapped.tags = updates.tags;
      await freshdeskUpdateTicket(fdAuth, Number(externalId), mapped);
    },

    async postReply(externalId: string, reply: UpstreamReply): Promise<void> {
      const { freshdeskReply } = await import('../../connectors/freshdesk.js');
      await freshdeskReply(fdAuth, Number(externalId), reply.body);
    },

    async postNote(externalId: string, note: UpstreamNote): Promise<void> {
      const { freshdeskAddNote } = await import('../../connectors/freshdesk.js');
      await freshdeskAddNote(fdAuth, Number(externalId), note.body);
    },

    async createTicket(ticket: UpstreamTicketCreate): Promise<UpstreamCreateResult> {
      const { freshdeskCreateTicket } = await import('../../connectors/freshdesk.js');
      const result = await freshdeskCreateTicket(
        fdAuth,
        ticket.subject,
        ticket.description,
        {
          email: ticket.requester,
          priority: ticket.priority ? (PRIORITY_MAP[ticket.priority] ?? 2) : undefined,
          status: 2, // open
          tags: ticket.tags,
        },
      );
      return { externalId: String(result.id) };
    },
  };
}
