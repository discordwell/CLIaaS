import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import {
  jsonResponse, HUBSPOT_AUTH,
  createTempDir, cleanupTempDir, readJsonlFile, liveTestsEnabled,
} from './_helpers.js';

const mockFetch = vi.fn();
beforeEach(() => { mockFetch.mockReset(); vi.stubGlobal('fetch', mockFetch); });
afterEach(() => { vi.restoreAllMocks(); });

// ---- CRUD lifecycle (mocked) ----

describe('HubSpot CRUD lifecycle (mocked)', () => {
  describe('verify', () => {
    it('returns success with portal ID and owner count', async () => {
      const { hubspotVerifyConnection } = await import('../../../connectors/hubspot.js');
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ portalId: 12345678 }))
        .mockResolvedValueOnce(jsonResponse({ results: [{ id: '1', firstName: 'Owner', lastName: 'O' }] }));

      const result = await hubspotVerifyConnection(HUBSPOT_AUTH);
      expect(result.success).toBe(true);
      expect(result.portalId).toBe('12345678');
      expect(result.ownerCount).toBe(1);
    });

    it('returns failure on auth error', async () => {
      const { hubspotVerifyConnection } = await import('../../../connectors/hubspot.js');
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }));

      const result = await hubspotVerifyConnection(HUBSPOT_AUTH);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('create', () => {
    it('creates a ticket and returns string ID', async () => {
      const { hubspotCreateTicket } = await import('../../../connectors/hubspot.js');
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'hub-ticket-001' }));

      const result = await hubspotCreateTicket(HUBSPOT_AUTH, 'Test ticket', 'Content here', {
        priority: 'high', ownerId: 'owner-1',
      });

      expect(result).toEqual({ id: 'hub-ticket-001' });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.hubapi.com/crm/v3/objects/tickets');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.properties.subject).toBe('Test ticket');
      expect(body.properties.content).toBe('Content here');
      expect(body.properties.hs_ticket_priority).toBe('high');
      expect(body.properties.hubspot_owner_id).toBe('owner-1');
    });
  });

  describe('note (2-step: create + associate)', () => {
    it('creates a note and associates it with the ticket', async () => {
      const { hubspotCreateNote } = await import('../../../connectors/hubspot.js');
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: 'note-001' })) // create note
        .mockResolvedValueOnce(jsonResponse({}));                 // associate

      const result = await hubspotCreateNote(HUBSPOT_AUTH, 'hub-ticket-001', 'Internal note');

      expect(result).toEqual({ id: 'note-001' });

      // First call: create note
      const [noteUrl, noteOpts] = mockFetch.mock.calls[0];
      expect(noteUrl).toContain('/crm/v3/objects/notes');
      expect(noteOpts.method).toBe('POST');
      const noteBody = JSON.parse(noteOpts.body);
      expect(noteBody.properties.hs_note_body).toBe('Internal note');

      // Second call: associate note with ticket
      const [assocUrl, assocOpts] = mockFetch.mock.calls[1];
      expect(assocUrl).toContain('/crm/v4/objects/notes/note-001/associations/tickets/hub-ticket-001');
      expect(assocOpts.method).toBe('PUT');
      const assocBody = JSON.parse(assocOpts.body);
      expect(assocBody[0].associationTypeId).toBe(17);
    });
  });
});

// ---- Export pipeline (mocked) ----

describe('HubSpot export pipeline (mocked)', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = createTempDir('hub-export'); });
  afterEach(() => { cleanupTempDir(tmpDir); });

  function mockFullExport() {
    mockFetch
      // 1. tickets page 1
      .mockResolvedValueOnce(jsonResponse({
        results: [{
          id: '1',
          properties: {
            subject: 'Issue', content: 'Help', hs_pipeline_stage: '1',
            hs_ticket_priority: 'high', hubspot_owner_id: '10',
            createdate: '2026-01-01T00:00:00Z', hs_lastmodifieddate: '2026-01-02T00:00:00Z',
          },
        }],
      }))
      // 2. associated contacts for ticket 1
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: '20', type: 'contact_to_ticket' }] }))
      // 3. associated notes for ticket 1
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: '100', type: 'note_to_ticket' }] }))
      // 4. note detail
      .mockResolvedValueOnce(jsonResponse({
        id: '100', properties: {
          hs_note_body: 'A note', hubspot_owner_id: '10', hs_timestamp: '2026-01-01T12:00:00Z',
        },
      }))
      // 5. email associations (empty)
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      // 5b. conversations list (empty)
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      // 6. contacts
      .mockResolvedValueOnce(jsonResponse({
        results: [{ id: '20', properties: { firstname: 'Bob', lastname: 'B', email: 'bob@t.com' } }],
      }))
      // 7. owners
      .mockResolvedValueOnce(jsonResponse({
        results: [{ id: '10', firstName: 'Owner', lastName: 'O', email: 'owner@h.com' }],
      }))
      // 8. companies (empty)
      .mockResolvedValueOnce(jsonResponse({ results: [] }));
  }

  it('exports tickets and notes to JSONL with correct IDs and source', async () => {
    const { exportHubSpot } = await import('../../../connectors/hubspot.js');

    mockFullExport();
    // KB (blog posts) — empty
    mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));
    // Workflows
    mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));

    const manifest = await exportHubSpot(HUBSPOT_AUTH, tmpDir);

    expect(manifest.source).toBe('hubspot');
    expect(manifest.counts.tickets).toBeGreaterThanOrEqual(1);

    const tickets = readJsonlFile(join(tmpDir, 'tickets.jsonl'));
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ id: 'hub-1', source: 'hubspot' });

    const messages = readJsonlFile(join(tmpDir, 'messages.jsonl'));
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0]).toMatchObject({ ticketId: 'hub-1' });
  });

  it('incremental sync uses search API with hs_lastmodifieddate filter', async () => {
    const { exportHubSpot } = await import('../../../connectors/hubspot.js');
    const lastSync = '2026-02-01T00:00:00Z';

    // Search endpoint for incremental tickets
    mockFetch.mockResolvedValueOnce(jsonResponse({
      results: [{
        id: '42',
        properties: {
          subject: 'Updated ticket', hs_pipeline_stage: '1',
          hs_ticket_priority: 'normal', hubspot_owner_id: '10',
          createdate: '2026-01-15T00:00:00Z', hs_lastmodifieddate: '2026-02-02T00:00:00Z',
        },
      }],
    }));
    // Associations for ticket 42
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ results: [] }))  // contacts
      .mockResolvedValueOnce(jsonResponse({ results: [] }))  // notes
      .mockResolvedValueOnce(jsonResponse({ results: [] })); // emails
    // Conversations (empty)
    mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));
    // Contacts, owners, companies
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ results: [] }))  // contacts
      .mockResolvedValueOnce(jsonResponse({ results: [] }))  // owners
      .mockResolvedValueOnce(jsonResponse({ results: [] })); // companies
    // KB + workflows
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ results: [] }))  // KB
      .mockResolvedValueOnce(jsonResponse({ results: [] })); // workflows

    await exportHubSpot(HUBSPOT_AUTH, tmpDir, { lastSyncAt: lastSync });

    // First call should be to search endpoint
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/crm/v3/objects/tickets/search');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.filterGroups[0].filters[0].propertyName).toBe('hs_lastmodifieddate');
    expect(body.filterGroups[0].filters[0].operator).toBe('GTE');
  });

  it('exports workflows to rules.jsonl', async () => {
    const { exportHubSpot } = await import('../../../connectors/hubspot.js');

    mockFullExport();
    // KB (empty)
    mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));
    // Workflows with data
    mockFetch.mockResolvedValueOnce(jsonResponse({
      results: [{
        id: 'wf-1', name: 'Auto-assign tickets', type: 'TICKET',
        enabled: true, actions: [{ type: 'SET_PROPERTY' }],
        enrollmentCriteria: { type: 'FILTER' },
      }],
    }));

    const manifest = await exportHubSpot(HUBSPOT_AUTH, tmpDir);

    expect(manifest.counts.rules).toBe(1);
    const rules = readJsonlFile(join(tmpDir, 'rules.jsonl'));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: 'hub-rule-wf-1', source: 'hubspot', type: 'automation' });
  });

  it('gracefully handles 403 for workflows (scope not granted)', async () => {
    const { exportHubSpot } = await import('../../../connectors/hubspot.js');

    mockFullExport();
    // KB (empty)
    mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));
    // Workflows — 403 Forbidden
    mockFetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403, statusText: 'Forbidden' }));

    const manifest = await exportHubSpot(HUBSPOT_AUTH, tmpDir);
    // Should still succeed, just with 0 rules
    expect(manifest.counts.rules).toBe(0);
  });
});

// ---- Live tests ----

describe.skipIf(!liveTestsEnabled() || !process.env.HUBSPOT_ACCESS_TOKEN)('HubSpot CRUD lifecycle (live)', () => {
  it('full lifecycle: verify → create → note', { timeout: 30_000 }, async () => {
    const { hubspotVerifyConnection, hubspotCreateTicket, hubspotCreateNote } =
      await import('../../../connectors/hubspot.js');
    const auth = { accessToken: process.env.HUBSPOT_ACCESS_TOKEN! };

    const verify = await hubspotVerifyConnection(auth);
    expect(verify.success).toBe(true);

    const created = await hubspotCreateTicket(auth, 'CLIaaS CRUD test', 'Automated test');
    expect(created.id).toBeTruthy();

    const note = await hubspotCreateNote(auth, created.id, 'Test internal note');
    expect(note.id).toBeTruthy();
  });
});
