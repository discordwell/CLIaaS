import type {
  ConnectorWriteAdapter,
  UpstreamTicketUpdate,
  UpstreamTicketCreate,
  UpstreamReply,
  UpstreamNote,
  UpstreamCreateResult,
} from '../upstream-adapter.js';

/** Map CLIaaS normalized status → Zendesk API status. */
const STATUS_MAP: Record<string, string> = {
  open: 'open',
  pending: 'pending',
  on_hold: 'hold',
  solved: 'solved',
  closed: 'closed',
};

/** Map CLIaaS normalized priority → Zendesk API priority. */
const PRIORITY_MAP: Record<string, string> = {
  low: 'low',
  normal: 'normal',
  high: 'high',
  urgent: 'urgent',
};

export function createZendeskAdapter(auth: Record<string, string>): ConnectorWriteAdapter {
  const { subdomain, email, token } = auth;

  return {
    name: 'zendesk',
    supportsUpdate: true,
    supportsReply: true,

    async updateTicket(externalId: string, updates: UpstreamTicketUpdate): Promise<void> {
      const { zendeskUpdateTicket } = await import('../../connectors/zendesk.js');
      const mapped: Record<string, unknown> = {};
      if (updates.status) mapped.status = STATUS_MAP[updates.status] ?? updates.status;
      if (updates.priority) mapped.priority = PRIORITY_MAP[updates.priority] ?? updates.priority;
      if (updates.tags) mapped.tags = updates.tags;
      await zendeskUpdateTicket(
        { subdomain, email, token },
        Number(externalId),
        mapped,
      );
    },

    async postReply(externalId: string, reply: UpstreamReply): Promise<void> {
      const { zendeskPostComment } = await import('../../connectors/zendesk.js');
      await zendeskPostComment({ subdomain, email, token }, Number(externalId), reply.body, true);
    },

    async postNote(externalId: string, note: UpstreamNote): Promise<void> {
      const { zendeskPostComment } = await import('../../connectors/zendesk.js');
      await zendeskPostComment({ subdomain, email, token }, Number(externalId), note.body, false);
    },

    async createTicket(ticket: UpstreamTicketCreate): Promise<UpstreamCreateResult> {
      const { zendeskCreateTicket } = await import('../../connectors/zendesk.js');
      const result = await zendeskCreateTicket(
        { subdomain, email, token },
        ticket.subject,
        ticket.description,
        {
          priority: ticket.priority ? (PRIORITY_MAP[ticket.priority] ?? ticket.priority) : undefined,
          tags: ticket.tags,
        },
      );
      return { externalId: String(result.id) };
    },
  };
}
