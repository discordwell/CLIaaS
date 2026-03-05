import type {
  ConnectorWriteAdapter,
  UpstreamTicketUpdate,
  UpstreamTicketCreate,
  UpstreamReply,
  UpstreamNote,
  UpstreamCreateResult,
} from '../upstream-adapter.js';

export function createZohoDeskAdapter(auth: Record<string, string>): ConnectorWriteAdapter {
  const zdAuth = { orgId: auth.orgId, accessToken: auth.token, apiDomain: auth.domain };

  return {
    name: 'zoho-desk',
    supportsUpdate: false,
    supportsReply: true,

    async updateTicket(): Promise<void> {
      throw new Error('Zoho Desk adapter does not support updateTicket');
    },

    async postReply(externalId: string, reply: UpstreamReply): Promise<void> {
      const { zodeskSendReply } = await import('../../connectors/zoho-desk.js');
      await zodeskSendReply(zdAuth, externalId, reply.body);
    },

    async postNote(externalId: string, note: UpstreamNote): Promise<void> {
      const { zodeskAddComment } = await import('../../connectors/zoho-desk.js');
      await zodeskAddComment(zdAuth, externalId, note.body, false);
    },

    async createTicket(ticket: UpstreamTicketCreate): Promise<UpstreamCreateResult> {
      const { zodeskCreateTicket } = await import('../../connectors/zoho-desk.js');
      const result = await zodeskCreateTicket(
        zdAuth,
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
