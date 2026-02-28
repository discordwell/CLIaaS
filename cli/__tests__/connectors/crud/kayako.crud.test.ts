import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import {
  jsonResponse, KAYAKO_AUTH,
  createTempDir, cleanupTempDir, readJsonlFile, liveTestsEnabled,
} from './_helpers.js';

const mockFetch = vi.fn();
beforeEach(async () => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  // Reset kayako session state between tests
  const m = await import('../../../connectors/kayako.js');
  m.resetSession();
});
afterEach(() => { vi.restoreAllMocks(); });

/** Kayako wraps most responses in { data: ... } and may include session_id */
function kayakoResponse(data: unknown, extra?: Record<string, unknown>) {
  return jsonResponse({ data, session_id: 'sess-abc', ...extra });
}

// ---- CRUD lifecycle (mocked) ----

describe('Kayako CRUD lifecycle (mocked)', () => {
  describe('verify', () => {
    it('returns success with user name and case count', async () => {
      const { kayakoVerifyConnection } = await import('../../../connectors/kayako.js');
      mockFetch
        .mockResolvedValueOnce(kayakoResponse([{ id: 1, full_name: 'Agent K' }]))
        .mockResolvedValueOnce(jsonResponse({ data: [], session_id: 'sess-abc', total_count: 15 }));

      const result = await kayakoVerifyConnection(KAYAKO_AUTH);
      expect(result.success).toBe(true);
      expect(result.userName).toBe('Agent K');
      expect(result.caseCount).toBe(15);
    });

    it('returns failure on auth error', async () => {
      const { kayakoVerifyConnection } = await import('../../../connectors/kayako.js');
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }));

      const result = await kayakoVerifyConnection(KAYAKO_AUTH);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('create', () => {
    it('creates a case and returns the ID', async () => {
      const { kayakoCreateCase } = await import('../../../connectors/kayako.js');
      mockFetch.mockResolvedValueOnce(kayakoResponse({ id: 501 }));

      const result = await kayakoCreateCase(KAYAKO_AUTH, 'New case', 'Case body', {
        priority: 'high', tags: ['cliaas-test-cleanup'],
      });

      expect(result).toEqual({ id: 501 });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/v1/cases.json');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.subject).toBe('New case');
      expect(body.contents).toBe('Case body');
      expect(body.tags).toEqual([{ name: 'cliaas-test-cleanup' }]);
    });
  });

  describe('update', () => {
    it('sends PATCH with correct payload', async () => {
      const { kayakoUpdateCase } = await import('../../../connectors/kayako.js');
      mockFetch.mockResolvedValueOnce(kayakoResponse({ id: 501 }));

      await kayakoUpdateCase(KAYAKO_AUTH, 501, { status: 'PENDING', priority: 'HIGH' });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/v1/cases/501.json');
      expect(opts.method).toBe('PATCH');
      const body = JSON.parse(opts.body);
      expect(body.status).toBe('PENDING');
      expect(body.priority).toBe('HIGH');
    });
  });

  describe('reply', () => {
    it('posts reply to correct endpoint', async () => {
      const { kayakoPostReply } = await import('../../../connectors/kayako.js');
      mockFetch.mockResolvedValueOnce(kayakoResponse({ id: 600 }));

      await kayakoPostReply(KAYAKO_AUTH, 501, 'Reply text');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/v1/cases/501/reply.json');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.contents).toBe('Reply text');
    });
  });

  describe('note', () => {
    it('posts note to correct endpoint', async () => {
      const { kayakoPostNote } = await import('../../../connectors/kayako.js');
      mockFetch.mockResolvedValueOnce(kayakoResponse({ id: 601 }));

      await kayakoPostNote(KAYAKO_AUTH, 501, 'Internal note');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/v1/cases/501/notes.json');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.body_text).toBe('Internal note');
    });
  });
});

// ---- Export pipeline (mocked) ----

describe('Kayako export pipeline (mocked)', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = createTempDir('ky-export'); });
  afterEach(() => { cleanupTempDir(tmpDir); });

  it('exports cases and messages to JSONL with correct IDs and source', async () => {
    const { exportKayako } = await import('../../../connectors/kayako.js');

    mockFetch
      // cases page 1
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: 1, subject: 'Help needed', status: { label: 'OPEN' }, priority: { label: 'HIGH' },
          assigned_agent: { id: 10, full_name: 'Agent K' },
          requester: { id: 20, full_name: 'User A', email: 'a@t.com' },
          tags: [{ name: 'bug' }], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
        }],
        session_id: 'sess-abc', total_count: 1,
      }))
      // (1 case < 100 → paginateOffset stops — no page 2)
      // posts for case 1
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 100, contents: 'Help!', creator: { id: 20, full_name: 'User A' }, source: 'MAIL', created_at: '2026-01-01T00:00:00Z' }],
        session_id: 'sess-abc',
      }))
      // (posts < 100 so cursor pagination stops — no page 2 needed)
      // notes for case 1 (empty)
      .mockResolvedValueOnce(jsonResponse({ data: [], session_id: 'sess-abc' }))
      // users page 1
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 20, full_name: 'User A', emails: [{ email: 'a@t.com', is_primary: true }], phones: [], role: 'customer' }],
        session_id: 'sess-abc', total_count: 1,
      }))
      // (1 user < 100 → stops)
      // organizations
      .mockResolvedValueOnce(jsonResponse({ data: [], session_id: 'sess-abc', total_count: 0 }))
      // KB articles
      .mockResolvedValueOnce(jsonResponse({ data: [], session_id: 'sess-abc', total_count: 0 }))
      // Triggers (rules)
      .mockResolvedValueOnce(jsonResponse({ data: [], session_id: 'sess-abc', total_count: 0 }));

    const manifest = await exportKayako(KAYAKO_AUTH, tmpDir);

    expect(manifest.source).toBe('kayako');
    expect(manifest.counts.tickets).toBeGreaterThanOrEqual(1);

    const tickets = readJsonlFile(join(tmpDir, 'tickets.jsonl'));
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ id: 'ky-1', source: 'kayako', subject: 'Help needed' });

    const messages = readJsonlFile(join(tmpDir, 'messages.jsonl'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: 'ky-msg-100', ticketId: 'ky-1' });
  });
});

// ---- Live tests ----

describe.skipIf(!liveTestsEnabled() || !process.env.KAYAKO_DOMAIN)('Kayako CRUD lifecycle (live)', () => {
  it('full lifecycle: verify → create → update → reply → note', { timeout: 30_000 }, async () => {
    const { kayakoVerifyConnection, kayakoCreateCase, kayakoUpdateCase, kayakoPostReply, kayakoPostNote } =
      await import('../../../connectors/kayako.js');
    const auth = {
      domain: process.env.KAYAKO_DOMAIN!,
      email: process.env.KAYAKO_EMAIL!,
      password: process.env.KAYAKO_PASSWORD!,
    };

    const verify = await kayakoVerifyConnection(auth);
    expect(verify.success).toBe(true);

    const created = await kayakoCreateCase(auth, 'CLIaaS CRUD test', 'Automated test', { tags: ['cliaas-test-cleanup'] });
    expect(created.id).toBeGreaterThan(0);

    await kayakoUpdateCase(auth, created.id, { priority: 'HIGH' });
    await kayakoPostReply(auth, created.id, 'Test reply');
    await kayakoPostNote(auth, created.id, 'Internal note');
  });
});
