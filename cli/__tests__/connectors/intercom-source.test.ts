import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

// Minimal fixtures

const conversation = {
  id: 'conv-1',
  title: 'Test conversation',
  state: 'open',
  priority: 'not_priority',
  created_at: 1700000000,
  updated_at: 1700001000,
  waiting_since: null,
  snoozed_until: null,
  source: { author: { id: 'user-1', type: 'user' }, body: 'Hello', delivered_as: 'customer_initiated' },
  assignee: { id: 'admin-1', type: 'admin' },
  tags: { tags: [] },
  contacts: { contacts: [{ id: 'contact-1', type: 'user' }] },
};

const icTicket = {
  id: 'tkt-1',
  ticket_id: '100',
  ticket_type: { id: 'type-1', name: 'Bug', description: 'Bug report' },
  ticket_attributes: { title: 'Bug report ticket' },
  ticket_state: 'submitted',
  open: true,
  created_at: 1700002000,
  updated_at: 1700003000,
  admin_assignee_id: 'admin-2',
  contacts: { contacts: [{ id: 'contact-2', type: 'user' }] },
};

function setupMockResponses({ includeConversation, includeTicket }: { includeConversation: boolean; includeTicket: boolean }) {
  const calls: Array<() => Response> = [];

  // 1. Conversations page 1
  calls.push(() => jsonResponse({
    conversations: includeConversation ? [conversation] : [],
    pages: {},
  }));

  // 2. Conversation detail (parts) — only if we have conversations
  if (includeConversation) {
    calls.push(() => jsonResponse({
      conversation_parts: { conversation_parts: [] },
    }));
  }

  // 3. Tickets page 1
  calls.push(() => jsonResponse({
    tickets: includeTicket ? [icTicket] : [],
    pages: {},
  }));

  // 4. Ticket detail (parts) — only if we have tickets
  if (includeTicket) {
    calls.push(() => jsonResponse({
      ticket_parts: { ticket_parts: [] },
    }));
  }

  // 5. Contacts page 1
  calls.push(() => jsonResponse({ data: [], pages: {} }));

  // 6. Admins
  calls.push(() => jsonResponse({ admins: [] }));

  // 7. Companies scroll
  calls.push(() => jsonResponse({ data: [], scroll_param: null }));

  // 8. Articles page 1
  calls.push(() => jsonResponse({ data: [], total_count: 0 }));

  for (const callFn of calls) {
    mockFetch.mockResolvedValueOnce(callFn());
  }
}

describe('Intercom source tagging', () => {
  it('exports include source=conversation for conversation-sourced tickets', async () => {
    vi.resetModules();
    setupMockResponses({ includeConversation: true, includeTicket: false });

    const { exportIntercom } = await import('../../connectors/intercom.js');
    const fs = await import('fs');
    const tmpDir = `/tmp/intercom-source-conv-test-${Date.now()}`;

    await exportIntercom({ accessToken: 'test-token' }, tmpDir);

    const ticketsContent = fs.readFileSync(`${tmpDir}/tickets.jsonl`, 'utf-8').trim().split('\n');
    expect(ticketsContent).toHaveLength(1);

    const ticket = JSON.parse(ticketsContent[0]);
    expect(ticket.id).toBe('ic-conv-1');
    expect(ticket.customFields).toBeDefined();
    expect(ticket.customFields.source).toBe('conversation');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exports include source=ticket for Tickets API sourced tickets', async () => {
    vi.resetModules();
    setupMockResponses({ includeConversation: false, includeTicket: true });

    const { exportIntercom } = await import('../../connectors/intercom.js');
    const fs = await import('fs');
    const tmpDir = `/tmp/intercom-source-tkt-test-${Date.now()}`;

    await exportIntercom({ accessToken: 'test-token' }, tmpDir);

    const ticketsContent = fs.readFileSync(`${tmpDir}/tickets.jsonl`, 'utf-8').trim().split('\n');
    expect(ticketsContent).toHaveLength(1);

    const ticket = JSON.parse(ticketsContent[0]);
    expect(ticket.id).toBe('ic-ticket-tkt-1');
    expect(ticket.customFields).toBeDefined();
    expect(ticket.customFields.source).toBe('ticket');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('manifest includes sourceTagging metadata', async () => {
    vi.resetModules();
    setupMockResponses({ includeConversation: true, includeTicket: true });

    const { exportIntercom } = await import('../../connectors/intercom.js');
    const fs = await import('fs');
    const tmpDir = `/tmp/intercom-source-manifest-test-${Date.now()}`;

    const manifest = await exportIntercom({ accessToken: 'test-token' }, tmpDir);

    // Check manifest object returned
    const manifestObj = manifest as Record<string, unknown>;
    expect(manifestObj.sourceTagging).toBeDefined();
    const tagging = manifestObj.sourceTagging as { enabled: boolean; field: string; values: string[] };
    expect(tagging.enabled).toBe(true);
    expect(tagging.field).toBe('customFields.source');
    expect(tagging.values).toEqual(['conversation', 'ticket']);

    // Also verify from the written file
    const writtenManifest = JSON.parse(fs.readFileSync(`${tmpDir}/manifest.json`, 'utf-8'));
    expect(writtenManifest.sourceTagging).toEqual({
      enabled: true,
      field: 'customFields.source',
      values: ['conversation', 'ticket'],
    });

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('both source types coexist when conversations and tickets are exported together', async () => {
    vi.resetModules();
    setupMockResponses({ includeConversation: true, includeTicket: true });

    const { exportIntercom } = await import('../../connectors/intercom.js');
    const fs = await import('fs');
    const tmpDir = `/tmp/intercom-source-both-test-${Date.now()}`;

    await exportIntercom({ accessToken: 'test-token' }, tmpDir);

    const ticketsContent = fs.readFileSync(`${tmpDir}/tickets.jsonl`, 'utf-8').trim().split('\n');
    expect(ticketsContent).toHaveLength(2);

    const convTicket = JSON.parse(ticketsContent[0]);
    const apiTicket = JSON.parse(ticketsContent[1]);

    expect(convTicket.id).toBe('ic-conv-1');
    expect(convTicket.customFields.source).toBe('conversation');

    expect(apiTicket.id).toBe('ic-ticket-tkt-1');
    expect(apiTicket.customFields.source).toBe('ticket');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
