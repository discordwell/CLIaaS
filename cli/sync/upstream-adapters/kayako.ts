import type {
  ConnectorWriteAdapter,
  UpstreamTicketUpdate,
  UpstreamTicketCreate,
  UpstreamReply,
  UpstreamNote,
  UpstreamCreateResult,
} from '../upstream-adapter.js';

export function createKayakoAdapter(auth: Record<string, string>): ConnectorWriteAdapter {
  const kyAuth = { domain: auth.domain, email: auth.email, password: auth.password };

  return {
    name: 'kayako',
    supportsUpdate: true,
    supportsReply: true,

    async updateTicket(externalId: string, updates: UpstreamTicketUpdate): Promise<void> {
      const { kayakoUpdateCase } = await import('../../connectors/kayako.js');
      const mapped: Record<string, unknown> = {};
      if (updates.status) mapped.status = updates.status;
      if (updates.priority) mapped.priority = updates.priority;
      if (updates.tags) mapped.tags = updates.tags;
      await kayakoUpdateCase(kyAuth, Number(externalId), mapped);
    },

    async postReply(externalId: string, reply: UpstreamReply): Promise<void> {
      const { kayakoPostReply } = await import('../../connectors/kayako.js');
      await kayakoPostReply(kyAuth, Number(externalId), reply.body);
    },

    async postNote(externalId: string, note: UpstreamNote): Promise<void> {
      const { kayakoPostNote } = await import('../../connectors/kayako.js');
      await kayakoPostNote(kyAuth, Number(externalId), note.body);
    },

    async createTicket(ticket: UpstreamTicketCreate): Promise<UpstreamCreateResult> {
      const { kayakoCreateCase } = await import('../../connectors/kayako.js');
      const result = await kayakoCreateCase(kyAuth, ticket.subject, ticket.description, {
        priority: ticket.priority,
        tags: ticket.tags,
      });
      return { externalId: String(result.id) };
    },
  };
}
