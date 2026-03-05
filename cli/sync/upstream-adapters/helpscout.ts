import type {
  ConnectorWriteAdapter,
  UpstreamTicketUpdate,
  UpstreamTicketCreate,
  UpstreamReply,
  UpstreamNote,
  UpstreamCreateResult,
} from '../upstream-adapter.js';

export function createHelpscoutAdapter(auth: Record<string, string>): ConnectorWriteAdapter {
  const hsAuth = { appId: auth.appId, appSecret: auth.appSecret };
  const mailboxId = Number(process.env.HELPSCOUT_MAILBOX_ID ?? '0');

  return {
    name: 'helpscout',
    supportsUpdate: false,
    supportsReply: true,

    async updateTicket(): Promise<void> {
      throw new Error('Help Scout adapter does not support updateTicket');
    },

    async postReply(externalId: string, reply: UpstreamReply): Promise<void> {
      const { helpscoutReply } = await import('../../connectors/helpscout.js');
      await helpscoutReply(hsAuth, Number(externalId), reply.body);
    },

    async postNote(externalId: string, note: UpstreamNote): Promise<void> {
      const { helpscoutAddNote } = await import('../../connectors/helpscout.js');
      await helpscoutAddNote(hsAuth, Number(externalId), note.body);
    },

    async createTicket(ticket: UpstreamTicketCreate): Promise<UpstreamCreateResult> {
      if (!mailboxId) throw new Error('HELPSCOUT_MAILBOX_ID env var required for ticket creation');
      const { helpscoutCreateConversation } = await import('../../connectors/helpscout.js');
      const result = await helpscoutCreateConversation(
        hsAuth,
        mailboxId,
        ticket.subject,
        ticket.description,
        {
          customerEmail: ticket.requester,
          tags: ticket.tags,
        },
      );
      return { externalId: String(result.id) };
    },
  };
}
