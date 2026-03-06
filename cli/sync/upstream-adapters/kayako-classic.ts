import type {
  ConnectorWriteAdapter,
  UpstreamTicketUpdate,
  UpstreamTicketCreate,
  UpstreamReply,
  UpstreamNote,
  UpstreamCreateResult,
} from '../upstream-adapter.js';

/** Map CLIaaS normalized status → Kayako Classic numeric status ID (defaults). */
const STATUS_MAP: Record<string, number> = {
  open: 1,
  pending: 2,
  on_hold: 2,
  solved: 3,
  closed: 3,
};

/** Map CLIaaS normalized priority → Kayako Classic numeric priority ID (defaults). */
const PRIORITY_MAP: Record<string, number> = {
  low: 4,
  normal: 1,
  high: 2,
  urgent: 3,
};

export function createKayakoClassicAdapter(auth: Record<string, string>): ConnectorWriteAdapter {
  const kycAuth = { domain: auth.domain, apiKey: auth.apiKey, secretKey: auth.secretKey };

  return {
    name: 'kayako-classic',
    supportsUpdate: true,
    supportsReply: true,

    async updateTicket(externalId: string, updates: UpstreamTicketUpdate): Promise<void> {
      const { kayakoClassicUpdateTicket } = await import('../../connectors/kayako-classic.js');
      const mapped: { statusid?: number; priorityid?: number } = {};
      if (updates.status) mapped.statusid = STATUS_MAP[updates.status] ?? 1;
      if (updates.priority) mapped.priorityid = PRIORITY_MAP[updates.priority] ?? 1;
      await kayakoClassicUpdateTicket(kycAuth, Number(externalId), mapped);
    },

    async postReply(externalId: string, reply: UpstreamReply): Promise<void> {
      const { kayakoClassicPostReply } = await import('../../connectors/kayako-classic.js');
      await kayakoClassicPostReply(kycAuth, Number(externalId), reply.body);
    },

    async postNote(externalId: string, note: UpstreamNote): Promise<void> {
      const { kayakoClassicPostNote } = await import('../../connectors/kayako-classic.js');
      await kayakoClassicPostNote(kycAuth, Number(externalId), note.body);
    },

    async createTicket(ticket: UpstreamTicketCreate): Promise<UpstreamCreateResult> {
      const deptId = process.env.KAYAKO_CLASSIC_DEPARTMENT_ID;
      if (!deptId) {
        throw new Error('Kayako Classic createTicket requires KAYAKO_CLASSIC_DEPARTMENT_ID env var');
      }
      const { kayakoClassicCreateTicket } = await import('../../connectors/kayako-classic.js');
      const result = await kayakoClassicCreateTicket(kycAuth, ticket.subject, ticket.description, {
        departmentid: Number(deptId),
      });
      return { externalId: String(result.id) };
    },
  };
}
