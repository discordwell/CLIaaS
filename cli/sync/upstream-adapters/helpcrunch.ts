import type {
  ConnectorWriteAdapter,
  UpstreamTicketUpdate,
  UpstreamTicketCreate,
  UpstreamReply,
  UpstreamNote,
  UpstreamCreateResult,
} from '../upstream-adapter.js';

/** Map CLIaaS status → HelpCrunch numeric status. */
const STATUS_MAP: Record<string, number> = {
  open: 0,     // new/open
  pending: 1,  // in progress
  on_hold: 1,  // in progress (closest match)
  solved: 2,   // closed
  closed: 2,   // closed
};

export function createHelpcrunchAdapter(auth: Record<string, string>): ConnectorWriteAdapter {
  const hcAuth = { apiKey: auth.apiKey };

  return {
    name: 'helpcrunch',
    supportsUpdate: true,
    supportsReply: true,

    async updateTicket(externalId: string, updates: UpstreamTicketUpdate): Promise<void> {
      const { helpcrunchUpdateChat } = await import('../../connectors/helpcrunch.js');
      const mapped: Record<string, unknown> = {};
      if (updates.status) mapped.status = STATUS_MAP[updates.status] ?? 0;
      await helpcrunchUpdateChat(hcAuth, Number(externalId), mapped);
    },

    async postReply(externalId: string, reply: UpstreamReply): Promise<void> {
      const { helpcrunchPostMessage } = await import('../../connectors/helpcrunch.js');
      await helpcrunchPostMessage(hcAuth, Number(externalId), reply.body);
    },

    async postNote(externalId: string, note: UpstreamNote): Promise<void> {
      // HelpCrunch uses the same message endpoint for notes
      const { helpcrunchPostMessage } = await import('../../connectors/helpcrunch.js');
      await helpcrunchPostMessage(hcAuth, Number(externalId), note.body);
    },

    async createTicket(ticket: UpstreamTicketCreate): Promise<UpstreamCreateResult> {
      const { helpcrunchCreateChat, helpcrunchSearchCustomers } = await import('../../connectors/helpcrunch.js');
      let customerId: number | undefined;
      if (ticket.requester) {
        const customers = await helpcrunchSearchCustomers(hcAuth, ticket.requester);
        if (customers.length > 0) {
          customerId = customers[0].id;
        }
      }
      if (customerId === undefined) {
        throw new Error('HelpCrunch createTicket requires a valid requester email that matches an existing customer');
      }
      const result = await helpcrunchCreateChat(hcAuth, customerId, ticket.description);
      return { externalId: String(result.id) };
    },
  };
}
