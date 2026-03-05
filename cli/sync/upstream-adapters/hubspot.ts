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
    supportsUpdate: false,
    supportsReply: false,

    async updateTicket(): Promise<void> {
      throw new Error('HubSpot adapter does not support updateTicket');
    },

    async postReply(): Promise<void> {
      throw new Error('HubSpot adapter does not support postReply');
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
