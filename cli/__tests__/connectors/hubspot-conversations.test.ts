import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  vi.resetModules();
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

// Error response for 403 (plan not available)
function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ message, status: 'error' }), {
    status,
    statusText: message,
    headers: { 'Content-Type': 'application/json' },
  });
}

const testAuth = { accessToken: 'test-hubspot-token' };

// Build a standard mock sequence that covers the full export pipeline,
// but with configurable conversations response.
function buildMockSequence(conversationsResponse: {
  listResponse?: Response;
  messagesResponses?: Record<string, Response>;
}) {
  return (url: string): Promise<Response> => {
    // Tickets — empty
    if (url.includes('/crm/v3/objects/tickets') && !url.includes('associations')) {
      return Promise.resolve(jsonResponse({ results: [], paging: null }));
    }

    // Conversations list
    if (url.includes('/conversations/v3/conversations/threads') && !url.includes('/messages')) {
      return Promise.resolve(
        conversationsResponse.listResponse ?? jsonResponse({ results: [], paging: null }),
      );
    }

    // Conversation messages
    if (url.includes('/conversations/v3/conversations/threads/') && url.includes('/messages')) {
      const match = url.match(/threads\/([^/]+)\/messages/);
      const convId = match?.[1] ?? '';
      const resp = conversationsResponse.messagesResponses?.[convId];
      return Promise.resolve(resp ?? jsonResponse({ results: [], paging: null }));
    }

    // Contacts — empty
    if (url.includes('/crm/v3/objects/contacts')) {
      return Promise.resolve(jsonResponse({ results: [], paging: null }));
    }

    // Owners
    if (url.includes('/crm/v3/owners')) {
      return Promise.resolve(jsonResponse({ results: [] }));
    }

    // Companies — empty
    if (url.includes('/crm/v3/objects/companies')) {
      return Promise.resolve(jsonResponse({ results: [], paging: null }));
    }

    // KB articles (blog posts) — empty
    if (url.includes('/cms/v3/blogs/posts')) {
      return Promise.resolve(jsonResponse({ results: [], paging: null }));
    }

    // KB articles (knowledge base) — empty
    if (url.includes('/cms/v3/knowledge-base')) {
      return Promise.resolve(jsonResponse({ results: [], paging: null }));
    }

    // Workflows — empty
    if (url.includes('/automation/v4/flows')) {
      return Promise.resolve(jsonResponse({ results: [] }));
    }

    // Default fallback
    return Promise.resolve(jsonResponse({ results: [], paging: null }));
  };
}

describe('HubSpot Conversations export', () => {
  it('exports conversations as tickets with threaded messages', async () => {
    const conversations = [
      {
        id: '101',
        subject: 'Billing question',
        status: 'OPEN',
        assignee: { actorId: 'A-1001', email: 'agent@example.com', name: 'Agent Smith' },
        channel: 'EMAIL',
        createdAt: '2026-01-15T10:00:00Z',
        updatedAt: '2026-01-16T08:30:00Z',
      },
      {
        id: '102',
        subject: null, // missing subject
        status: 'CLOSED',
        channel: 'CHAT',
        createdAt: '2026-02-01T12:00:00Z',
        updatedAt: '2026-02-02T14:00:00Z',
      },
    ];

    const conv101Messages = [
      {
        id: 'msg-201',
        text: 'Hi, I have a billing question.',
        type: 'MESSAGE',
        senders: [{ email: 'customer@example.com', deliveryIdentifier: { type: 'EMAIL', value: 'customer@example.com' } }],
        createdAt: '2026-01-15T10:01:00Z',
      },
      {
        id: 'msg-202',
        text: 'Sure, let me look into it.',
        richText: '<p>Sure, let me look into it.</p>',
        type: 'MESSAGE',
        senders: [{ actorId: 'A-1001', email: 'agent@example.com' }],
        createdAt: '2026-01-15T10:05:00Z',
      },
      {
        id: 'msg-203',
        text: 'Internal note: escalate to finance',
        type: 'NOTE',
        senders: [{ actorId: 'A-1001' }],
        createdAt: '2026-01-15T10:10:00Z',
      },
      {
        id: 'msg-204',
        text: '', // empty body — should be skipped
        type: 'MESSAGE',
        senders: [],
        createdAt: '2026-01-15T10:15:00Z',
      },
    ];

    const conv102Messages = [
      {
        id: 'msg-301',
        text: 'Chat started',
        type: 'STATUS_CHANGE',
        senders: [],
        createdAt: '2026-02-01T12:00:00Z',
      },
      {
        id: 'msg-302',
        text: 'Hello, need help with login',
        type: 'MESSAGE',
        senders: [{ deliveryIdentifier: { type: 'CHAT', value: 'visitor-5678' } }],
        createdAt: '2026-02-01T12:01:00Z',
      },
    ];

    mockFetch.mockImplementation(buildMockSequence({
      listResponse: jsonResponse({ results: conversations, paging: null }),
      messagesResponses: {
        '101': jsonResponse({ results: conv101Messages, paging: null }),
        '102': jsonResponse({ results: conv102Messages, paging: null }),
      },
    }));

    const { exportHubSpot } = await import('../../connectors/hubspot.js');
    const tmpDir = `/tmp/hubspot-conv-test-${Date.now()}`;

    const manifest = await exportHubSpot(testAuth, tmpDir);

    // 2 conversations = 2 tickets
    expect(manifest.counts.tickets).toBe(2);

    // 3 messages from conv 101 (one skipped empty) + 2 from conv 102 = 5
    expect(manifest.counts.messages).toBe(5);

    // Verify ticket normalization
    const ticketLines = fs.readFileSync(`${tmpDir}/tickets.jsonl`, 'utf-8').trim().split('\n');
    expect(ticketLines).toHaveLength(2);

    const ticket1 = JSON.parse(ticketLines[0]);
    expect(ticket1.id).toBe('hub-conv-101');
    expect(ticket1.externalId).toBe('conv-101');
    expect(ticket1.source).toBe('hubspot');
    expect(ticket1.subject).toBe('Billing question');
    expect(ticket1.status).toBe('open');
    expect(ticket1.assignee).toBe('A-1001');
    expect(ticket1.tags).toEqual(['channel:email']);
    expect(ticket1.createdAt).toBe('2026-01-15T10:00:00Z');

    const ticket2 = JSON.parse(ticketLines[1]);
    expect(ticket2.id).toBe('hub-conv-102');
    expect(ticket2.subject).toBe('Conversation #102'); // fallback subject
    expect(ticket2.status).toBe('closed');
    expect(ticket2.tags).toEqual(['channel:chat']);

    // Verify message normalization and threading
    const messageLines = fs.readFileSync(`${tmpDir}/messages.jsonl`, 'utf-8').trim().split('\n');
    expect(messageLines).toHaveLength(5);

    const msg1 = JSON.parse(messageLines[0]);
    expect(msg1.id).toBe('hub-convmsg-msg-201');
    expect(msg1.ticketId).toBe('hub-conv-101');
    expect(msg1.author).toBe('customer@example.com');
    expect(msg1.body).toBe('Hi, I have a billing question.');
    expect(msg1.type).toBe('reply');

    const msg2 = JSON.parse(messageLines[1]);
    expect(msg2.id).toBe('hub-convmsg-msg-202');
    expect(msg2.ticketId).toBe('hub-conv-101');
    expect(msg2.author).toBe('agent@example.com');
    expect(msg2.bodyHtml).toBe('<p>Sure, let me look into it.</p>');
    expect(msg2.type).toBe('reply');

    // Note type
    const msg3 = JSON.parse(messageLines[2]);
    expect(msg3.id).toBe('hub-convmsg-msg-203');
    expect(msg3.type).toBe('note');
    expect(msg3.author).toBe('A-1001');

    // STATUS_CHANGE = system
    const msg4 = JSON.parse(messageLines[3]);
    expect(msg4.id).toBe('hub-convmsg-msg-301');
    expect(msg4.ticketId).toBe('hub-conv-102');
    expect(msg4.type).toBe('system');

    // Chat message with deliveryIdentifier
    const msg5 = JSON.parse(messageLines[4]);
    expect(msg5.id).toBe('hub-convmsg-msg-302');
    expect(msg5.author).toBe('visitor-5678');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles 403 gracefully when Conversations API is not available', async () => {
    mockFetch.mockImplementation(buildMockSequence({
      listResponse: errorResponse(403, 'Forbidden'),
    }));

    const { exportHubSpot } = await import('../../connectors/hubspot.js');
    const tmpDir = `/tmp/hubspot-conv-403-test-${Date.now()}`;

    // Should not throw
    const manifest = await exportHubSpot(testAuth, tmpDir);

    // No conversation tickets or messages
    expect(manifest.counts.tickets).toBe(0);
    expect(manifest.counts.messages).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles 404 gracefully when endpoint does not exist', async () => {
    mockFetch.mockImplementation(buildMockSequence({
      listResponse: errorResponse(404, 'Not Found'),
    }));

    const { exportHubSpot } = await import('../../connectors/hubspot.js');
    const tmpDir = `/tmp/hubspot-conv-404-test-${Date.now()}`;

    const manifest = await exportHubSpot(testAuth, tmpDir);

    expect(manifest.counts.tickets).toBe(0);
    expect(manifest.counts.messages).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles message fetch failure for individual conversations gracefully', async () => {
    const conversations = [
      {
        id: '201',
        subject: 'Good conversation',
        status: 'OPEN',
        channel: 'EMAIL',
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T12:00:00Z',
      },
      {
        id: '202',
        subject: 'Conversation with broken messages',
        status: 'OPEN',
        channel: 'CHAT',
        createdAt: '2026-03-02T10:00:00Z',
        updatedAt: '2026-03-02T12:00:00Z',
      },
    ];

    const conv201Messages = [
      {
        id: 'msg-401',
        text: 'Hello!',
        type: 'MESSAGE',
        senders: [{ email: 'user@example.com' }],
        createdAt: '2026-03-01T10:01:00Z',
      },
    ];

    mockFetch.mockImplementation((url: string) => {
      // Conversation messages for 202 throws an error
      if (url.includes('/threads/202/messages')) {
        return Promise.resolve(errorResponse(500, 'Internal Server Error'));
      }
      return buildMockSequence({
        listResponse: jsonResponse({ results: conversations, paging: null }),
        messagesResponses: {
          '201': jsonResponse({ results: conv201Messages, paging: null }),
        },
      })(url);
    });

    const { exportHubSpot } = await import('../../connectors/hubspot.js');
    const tmpDir = `/tmp/hubspot-conv-partial-fail-${Date.now()}`;

    const manifest = await exportHubSpot(testAuth, tmpDir);

    // Both conversations become tickets
    expect(manifest.counts.tickets).toBe(2);

    // Only conv 201 messages come through (conv 202 messages failed)
    expect(manifest.counts.messages).toBe(1);

    const messageLines = fs.readFileSync(`${tmpDir}/messages.jsonl`, 'utf-8').trim().split('\n');
    expect(messageLines).toHaveLength(1);
    const msg = JSON.parse(messageLines[0]);
    expect(msg.ticketId).toBe('hub-conv-201');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('paginates conversations across multiple pages', async () => {
    const page1Convs = Array.from({ length: 2 }, (_, i) => ({
      id: `p1-${i}`,
      subject: `Page1 Conv ${i}`,
      status: 'OPEN',
      channel: 'EMAIL',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T12:00:00Z',
    }));

    const page2Convs = Array.from({ length: 1 }, (_, i) => ({
      id: `p2-${i}`,
      subject: `Page2 Conv ${i}`,
      status: 'CLOSED',
      channel: 'CHAT',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T12:00:00Z',
    }));

    let convCallCount = 0;

    mockFetch.mockImplementation((url: string) => {
      // Conversations list — paginated
      if (url.includes('/conversations/v3/conversations/threads') && !url.includes('/messages')) {
        convCallCount++;
        if (!url.includes('after=')) {
          // First page — include paging cursor
          return Promise.resolve(jsonResponse({
            results: page1Convs,
            paging: { next: { after: 'cursor-page2' } },
          }));
        } else {
          // Second page — no more
          return Promise.resolve(jsonResponse({
            results: page2Convs,
            paging: null,
          }));
        }
      }

      // Messages — empty for all conversations
      if (url.includes('/messages')) {
        return Promise.resolve(jsonResponse({ results: [], paging: null }));
      }

      // Other endpoints — default empty
      return buildMockSequence({})(url);
    });

    const { exportHubSpot } = await import('../../connectors/hubspot.js');
    const tmpDir = `/tmp/hubspot-conv-pagination-${Date.now()}`;

    const manifest = await exportHubSpot(testAuth, tmpDir);

    // 3 conversations total across 2 pages
    expect(manifest.counts.tickets).toBe(3);

    // Two calls to the conversations list endpoint
    expect(convCallCount).toBe(2);

    const ticketLines = fs.readFileSync(`${tmpDir}/tickets.jsonl`, 'utf-8').trim().split('\n');
    expect(ticketLines).toHaveLength(3);

    // Verify page 2 conversation status
    const lastTicket = JSON.parse(ticketLines[2]);
    expect(lastTicket.status).toBe('closed');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
