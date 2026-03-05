import type {
  ConnectorWriteAdapter,
  UpstreamTicketUpdate,
  UpstreamTicketCreate,
  UpstreamReply,
  UpstreamNote,
  UpstreamCreateResult,
} from '../upstream-adapter.js';

/** Map CLIaaS status → Groove state. */
const STATUS_MAP: Record<string, string> = {
  open: 'opened',
  pending: 'pending',
  on_hold: 'pending',
  solved: 'closed',
  closed: 'closed',
};

export function createGrooveAdapter(auth: Record<string, string>): ConnectorWriteAdapter {
  const gAuth = { apiToken: auth.apiKey };

  return {
    name: 'groove',
    supportsUpdate: true,
    supportsReply: true,

    async updateTicket(externalId: string, updates: UpstreamTicketUpdate): Promise<void> {
      const { grooveUpdateTicket } = await import('../../connectors/groove.js');
      const mapped: Record<string, unknown> = {};
      if (updates.status) mapped.state = STATUS_MAP[updates.status] ?? updates.status;
      if (updates.assignee) mapped.assignee = updates.assignee;
      if (updates.tags) mapped.tags = updates.tags;
      await grooveUpdateTicket(gAuth, Number(externalId), mapped);
    },

    async postReply(externalId: string, reply: UpstreamReply): Promise<void> {
      const { groovePostMessage } = await import('../../connectors/groove.js');
      await groovePostMessage(gAuth, Number(externalId), reply.body, false);
    },

    async postNote(externalId: string, note: UpstreamNote): Promise<void> {
      const { groovePostMessage } = await import('../../connectors/groove.js');
      await groovePostMessage(gAuth, Number(externalId), note.body, true);
    },

    async createTicket(ticket: UpstreamTicketCreate): Promise<UpstreamCreateResult> {
      const { grooveCreateTicket } = await import('../../connectors/groove.js');
      const result = await grooveCreateTicket(
        gAuth,
        ticket.requester ?? 'noreply@cliaas.com',
        ticket.description,
        {
          subject: ticket.subject,
          tags: ticket.tags,
        },
      );
      return { externalId: String(result.number) };
    },
  };
}
