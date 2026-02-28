import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import {
  xmlResponse, KAYAKO_CLASSIC_AUTH,
  createTempDir, cleanupTempDir, readJsonlFile, liveTestsEnabled,
} from './_helpers.js';

const mockFetch = vi.fn();
beforeEach(() => { mockFetch.mockReset(); vi.stubGlobal('fetch', mockFetch); });
afterEach(() => { vi.restoreAllMocks(); });

/** Build an XML response wrapping tickets */
function ticketXml(id: number, displayId: string, subject: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<tickets>
  <ticket>
    <id>${id}</id>
    <displayid>${displayId}</displayid>
    <subject>${subject}</subject>
    <statusid>1</statusid>
    <priorityid>2</priorityid>
    <departmentid>1</departmentid>
    <ownerstaffid>0</ownerstaffid>
    <userid>10</userid>
    <fullname>Test User</fullname>
    <email>user@test.com</email>
    <tags></tags>
    <creationtime>1706745600</creationtime>
    <lastactivity>1706832000</lastactivity>
    <totalreplies>0</totalreplies>
  </ticket>
</tickets>`;
}

function emptyXml(root: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><${root}></${root}>`;
}

// ---- CRUD lifecycle (mocked) ----

describe('Kayako Classic CRUD lifecycle (mocked)', () => {
  describe('verify', () => {
    it('returns success with departments and ticket count', async () => {
      const { kayakoClassicVerifyConnection } = await import('../../../connectors/kayako-classic.js');
      mockFetch
        // /Base/Department
        .mockResolvedValueOnce(xmlResponse(`<?xml version="1.0"?>
          <departments><department><id>1</id><title>Support</title></department></departments>`))
        // /Tickets/TicketCount
        .mockResolvedValueOnce(xmlResponse(`<?xml version="1.0"?>
          <ticketcount><departments><department><departmentid>1</departmentid><totalitems>5</totalitems></department></departments></ticketcount>`));

      const result = await kayakoClassicVerifyConnection(KAYAKO_CLASSIC_AUTH);
      expect(result.success).toBe(true);
      expect(result.departments).toContain('Support');
      expect(result.ticketCount).toBe(5);
    });

    it('returns failure on auth error', async () => {
      const { kayakoClassicVerifyConnection } = await import('../../../connectors/kayako-classic.js');
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }));

      const result = await kayakoClassicVerifyConnection(KAYAKO_CLASSIC_AUTH);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('create', () => {
    it('creates a ticket and returns id + displayId', async () => {
      const { kayakoClassicCreateTicket } = await import('../../../connectors/kayako-classic.js');
      mockFetch.mockResolvedValueOnce(xmlResponse(ticketXml(42, 'TKT-42', 'New ticket')));

      const result = await kayakoClassicCreateTicket(KAYAKO_CLASSIC_AUTH, 'New ticket', 'Body text', {
        departmentid: 1, fullname: 'Test User', email: 'user@test.com',
      });

      expect(result.id).toBe(42);
      expect(result.displayId).toBe('TKT-42');
      // Kayako Classic uses form-encoded POST
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/Tickets/Ticket');
      expect(opts.method).toBe('POST');
      expect(opts.body).toContain('subject=New%20ticket');
    });
  });

  describe('update', () => {
    it('sends PUT with form-encoded body', async () => {
      const { kayakoClassicUpdateTicket } = await import('../../../connectors/kayako-classic.js');
      mockFetch.mockResolvedValueOnce(xmlResponse(ticketXml(42, 'TKT-42', 'Updated')));

      await kayakoClassicUpdateTicket(KAYAKO_CLASSIC_AUTH, 42, { statusid: 2, priorityid: 3 });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/Tickets/Ticket/42');
      expect(opts.method).toBe('PUT');
      expect(opts.body).toContain('ticketstatusid=2');
      expect(opts.body).toContain('ticketpriorityid=3');
    });
  });

  describe('reply', () => {
    it('posts reply to correct endpoint', async () => {
      const { kayakoClassicPostReply } = await import('../../../connectors/kayako-classic.js');
      mockFetch.mockResolvedValueOnce(xmlResponse(emptyXml('ticketposts')));

      await kayakoClassicPostReply(KAYAKO_CLASSIC_AUTH, 42, 'Reply content');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/Tickets/TicketPost/Ticket/42');
      expect(opts.method).toBe('POST');
      expect(opts.body).toContain('contents=Reply%20content');
    });
  });

  describe('note', () => {
    it('posts note with yellow color to correct endpoint', async () => {
      const { kayakoClassicPostNote } = await import('../../../connectors/kayako-classic.js');
      mockFetch.mockResolvedValueOnce(xmlResponse(emptyXml('ticketnotes')));

      await kayakoClassicPostNote(KAYAKO_CLASSIC_AUTH, 42, 'Internal note');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/Tickets/TicketNote/Ticket/42');
      expect(opts.method).toBe('POST');
      expect(opts.body).toContain('contents=Internal%20note');
      expect(opts.body).toContain('notecolor=1');
    });
  });
});

// ---- Export pipeline (mocked) ----

describe('Kayako Classic export pipeline (mocked)', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = createTempDir('kyc-export'); });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('exports tickets and messages to JSONL with correct IDs and source', async () => {
    const { exportKayakoClassic } = await import('../../../connectors/kayako-classic.js');

    mockFetch
      // 1. /Tickets/TicketStatus
      .mockResolvedValueOnce(xmlResponse(`<?xml version="1.0"?>
        <ticketstatuses><ticketstatus><id>1</id><title>Open</title></ticketstatus></ticketstatuses>`))
      // 2. /Tickets/TicketPriority
      .mockResolvedValueOnce(xmlResponse(`<?xml version="1.0"?>
        <ticketpriorities><ticketpriority><id>2</id><title>Normal</title></ticketpriority></ticketpriorities>`))
      // 3. /Tickets/Ticket/ListAll/-1/-1/-1/-1/100/0 (batch 1)
      .mockResolvedValueOnce(xmlResponse(`<?xml version="1.0"?>
        <tickets>
          <ticket>
            <id>1</id><displayid>TKT-1</displayid><subject>Bug report</subject>
            <statusid>1</statusid><priorityid>2</priorityid><departmentid>1</departmentid>
            <ownerstaffid>10</ownerstaffid><ownerstaffname>Agent</ownerstaffname>
            <userid>20</userid><fullname>Alice</fullname>
            <email>alice@t.com</email><tags></tags>
            <creationtime>1706745600</creationtime><lastactivity>1706832000</lastactivity>
          </ticket>
        </tickets>`))
      // 4. /Tickets/TicketPost/ListAll/1 (posts for ticket 1)
      .mockResolvedValueOnce(xmlResponse(`<?xml version="1.0"?>
        <ticketposts>
          <ticketpost>
            <id>100</id><ticketpostid>100</ticketpostid><ticketid>1</ticketid>
            <contents>Help me!</contents><fullname>Alice</fullname><email>alice@t.com</email>
            <dateline>1706745600</dateline><isprivate>0</isprivate><ishtml>0</ishtml>
          </ticketpost>
        </ticketposts>`))
      // 5. /Tickets/TicketNote/ListAll/1 (notes for ticket 1 — empty)
      .mockResolvedValueOnce(xmlResponse(emptyXml('ticketnotes')))
      // 6. /Tickets/Ticket/ListAll/-1/-1/-1/-1/100/1 (batch 2 — empty, stops)
      .mockResolvedValueOnce(xmlResponse(emptyXml('tickets')))
      // 7. /Base/User/Filter/1/1000 (users batch 1)
      .mockResolvedValueOnce(xmlResponse(`<?xml version="1.0"?>
        <users><user><id>20</id><fullname>Alice</fullname><email>alice@t.com</email><phone></phone><userorganizationid>0</userorganizationid></user></users>`))
      // 8. Users batch 2 — empty (< 1000 → stops)
      // Note: with 1 user < 1000, it stops after the first batch. No second call needed.
      // 9. /Base/UserOrganization (organizations)
      .mockResolvedValueOnce(xmlResponse(emptyXml('userorganizations')))
      // 10. /Knowledgebase/Article (KB articles)
      .mockResolvedValueOnce(xmlResponse(emptyXml('kbarticles')))
      // 11. /Base/Department (departments for rules)
      .mockResolvedValueOnce(xmlResponse(`<?xml version="1.0"?>
        <departments><department><id>1</id><title>Support</title></department></departments>`));

    const manifest = await exportKayakoClassic(KAYAKO_CLASSIC_AUTH, tmpDir);

    expect(manifest.source).toBe('kayako-classic');
    expect(manifest.counts.tickets).toBeGreaterThanOrEqual(1);

    const tickets = readJsonlFile(join(tmpDir, 'tickets.jsonl'));
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ id: 'kyc-1', source: 'kayako-classic' });

    const messages = readJsonlFile(join(tmpDir, 'messages.jsonl'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ticketId: 'kyc-1' });
  });
});

// ---- Live tests ----

describe.skipIf(!liveTestsEnabled() || !process.env.KAYAKO_CLASSIC_DOMAIN)('Kayako Classic CRUD lifecycle (live)', () => {
  it('full lifecycle: verify → create → update → reply → note', { timeout: 30_000 }, async () => {
    const { kayakoClassicVerifyConnection, kayakoClassicCreateTicket, kayakoClassicUpdateTicket, kayakoClassicPostReply, kayakoClassicPostNote } =
      await import('../../../connectors/kayako-classic.js');
    const auth = {
      domain: process.env.KAYAKO_CLASSIC_DOMAIN!,
      apiKey: process.env.KAYAKO_CLASSIC_API_KEY!,
      secretKey: process.env.KAYAKO_CLASSIC_SECRET_KEY!,
    };

    const verify = await kayakoClassicVerifyConnection(auth);
    expect(verify.success).toBe(true);

    const created = await kayakoClassicCreateTicket(auth, 'CLIaaS CRUD test', 'Automated test', { departmentid: 1 });
    expect(created.id).toBeGreaterThan(0);

    await kayakoClassicUpdateTicket(auth, created.id, { priorityid: 3 });
    await kayakoClassicPostReply(auth, created.id, 'Test reply');
    await kayakoClassicPostNote(auth, created.id, 'Internal note');
  });
});
