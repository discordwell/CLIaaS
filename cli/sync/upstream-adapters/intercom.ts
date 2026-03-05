import type {
  ConnectorWriteAdapter,
  UpstreamTicketUpdate,
  UpstreamTicketCreate,
  UpstreamReply,
  UpstreamNote,
  UpstreamCreateResult,
} from '../upstream-adapter.js';

export function createIntercomAdapter(auth: Record<string, string>): ConnectorWriteAdapter {
  const icAuth = { accessToken: auth.token };
  const adminId = process.env.INTERCOM_ADMIN_ID ?? '';

  return {
    name: 'intercom',
    supportsUpdate: false,
    supportsReply: true,

    async updateTicket(): Promise<void> {
      throw new Error('Intercom adapter does not support updateTicket');
    },

    async postReply(externalId: string, reply: UpstreamReply): Promise<void> {
      if (!adminId) throw new Error('INTERCOM_ADMIN_ID env var required for replies');
      const { intercomReplyToConversation } = await import('../../connectors/intercom.js');
      await intercomReplyToConversation(icAuth, externalId, reply.body, adminId);
    },

    async postNote(externalId: string, note: UpstreamNote): Promise<void> {
      if (!adminId) throw new Error('INTERCOM_ADMIN_ID env var required for notes');
      const { intercomAddNote } = await import('../../connectors/intercom.js');
      await intercomAddNote(icAuth, externalId, note.body, adminId);
    },

    async createTicket(ticket: UpstreamTicketCreate): Promise<UpstreamCreateResult> {
      const { intercomCreateConversation } = await import('../../connectors/intercom.js');
      // Intercom requires a contact ID — use requester email as a fallback identifier
      const result = await intercomCreateConversation(
        icAuth,
        ticket.requester ?? '',
        ticket.description,
      );
      return { externalId: String(result.id) };
    },
  };
}
