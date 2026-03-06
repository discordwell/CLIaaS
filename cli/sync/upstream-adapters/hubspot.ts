import type {
  ConnectorWriteAdapter,
  UpstreamTicketUpdate,
  UpstreamTicketCreate,
  UpstreamReply,
  UpstreamNote,
  UpstreamCreateResult,
} from '../upstream-adapter.js';

export function createHubspotAdapter(auth: Record<string, string>): ConnectorWriteAdapter {
  const hbAuth = { accessToken: auth.token };

  return {
    name: 'hubspot',
    supportsUpdate: true,
    supportsReply: true,

    async updateTicket(externalId: string, updates: UpstreamTicketUpdate): Promise<void> {
      const { hubspotUpdateTicket } = await import('../../connectors/hubspot.js');
      const mapped: { status?: string; priority?: string; assignee?: string } = {};
      if (updates.status) mapped.status = updates.status;
      if (updates.priority) mapped.priority = updates.priority;
      if (updates.assignee) mapped.assignee = updates.assignee;
      await hubspotUpdateTicket(hbAuth, externalId, mapped);
    },

    async postReply(externalId: string, reply: UpstreamReply): Promise<void> {
      const { hubspotPostReply } = await import('../../connectors/hubspot.js');
      await hubspotPostReply(hbAuth, externalId, reply.body);
    },

    async postNote(externalId: string, note: UpstreamNote): Promise<void> {
      const { hubspotCreateNote } = await import('../../connectors/hubspot.js');
      await hubspotCreateNote(hbAuth, externalId, note.body);
    },

    async createTicket(ticket: UpstreamTicketCreate): Promise<UpstreamCreateResult> {
      const { hubspotCreateTicket } = await import('../../connectors/hubspot.js');
      const result = await hubspotCreateTicket(
        hbAuth,
        ticket.subject,
        ticket.description,
        {
          priority: ticket.priority,
        },
      );
      return { externalId: String(result.id) };
    },
  };
}
