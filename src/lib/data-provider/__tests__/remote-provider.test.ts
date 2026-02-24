import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Ticket, Message, KBArticle, Customer, Organization, RuleRecord, CSATRating } from '../types';

// We need to mock global fetch before importing the provider
const mockFetch = vi.fn();

// Store original fetch
const originalFetch = globalThis.fetch;

// Sample data used across tests
const sampleTicket: Ticket = {
  id: 't1',
  externalId: '100',
  source: 'zendesk',
  subject: 'Help needed',
  status: 'open',
  priority: 'high',
  requester: 'alice@example.com',
  tags: ['billing'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const sampleMessage: Message = {
  id: 'm1',
  ticketId: 't1',
  author: 'alice',
  body: 'Hello',
  type: 'reply',
  createdAt: '2026-01-01T00:00:00Z',
};

const sampleArticle: KBArticle = {
  id: 'kb1',
  title: 'Password reset',
  body: 'Go to settings...',
  categoryPath: ['Account'],
};

const sampleCustomer: Customer = {
  id: 'c1',
  name: 'Alice',
  email: 'alice@example.com',
  source: 'zendesk',
};

const sampleOrg: Organization = {
  id: 'o1',
  name: 'Acme Inc',
  source: 'zendesk',
};

const sampleRule: RuleRecord = {
  id: 'r1',
  type: 'trigger',
  name: 'Auto-prioritize',
  enabled: true,
  conditions: {},
  actions: [],
};

const sampleRating: CSATRating = {
  ticketId: 't1',
  rating: 5,
  createdAt: '2026-01-01T00:00:00Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, body?: unknown): Response {
  return new Response(body ? JSON.stringify(body) : 'Error', {
    status,
    headers: body ? { 'Content-Type': 'application/json' } : {},
  });
}

describe('RemoteProvider', () => {
  beforeEach(() => {
    vi.stubEnv('CLIAAS_HOSTED_URL', 'https://api.cliaas.test');
    vi.stubEnv('CLIAAS_HOSTED_API_KEY', 'test-key-123');
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  async function createProvider() {
    // Dynamic import to pick up env changes
    const mod = await import('../remote-provider');
    return new mod.RemoteProvider();
  }

  describe('constructor', () => {
    it('throws when CLIAAS_HOSTED_URL is not set and no config fallback', async () => {
      vi.stubEnv('CLIAAS_HOSTED_URL', '');
      vi.stubEnv('CLIAAS_HOSTED_API_KEY', '');
      await expect(createProvider()).rejects.toThrow('requires a hosted API URL');
    });

    it('creates successfully with env vars', async () => {
      const provider = await createProvider();
      expect(provider.capabilities.mode).toBe('remote');
      expect(provider.capabilities.supportsWrite).toBe(true);
    });
  });

  describe('loadTickets', () => {
    it('fetches all tickets with pagination', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ tickets: [sampleTicket], total: 1, limit: 200, offset: 0 }),
      );

      const provider = await createProvider();
      const tickets = await provider.loadTickets();

      expect(tickets).toHaveLength(1);
      expect(tickets[0].subject).toBe('Help needed');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('/api/tickets');
      expect(callUrl).toContain('limit=200');
    });

    it('handles multi-page results', async () => {
      const page1Tickets = Array.from({ length: 200 }, (_, i) => ({
        ...sampleTicket,
        id: `t${i}`,
      }));
      const page2Tickets = [{ ...sampleTicket, id: 't200' }];

      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({ tickets: page1Tickets, total: 201, limit: 200, offset: 0 }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ tickets: page2Tickets, total: 201, limit: 200, offset: 200 }),
        );

      const provider = await createProvider();
      const tickets = await provider.loadTickets();

      expect(tickets).toHaveLength(201);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('loadMessages', () => {
    it('fetches messages for a specific ticket via /api/tickets/:id', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ ticket: sampleTicket, messages: [sampleMessage] }),
      );

      const provider = await createProvider();
      const messages = await provider.loadMessages('t1');

      expect(messages).toHaveLength(1);
      expect(messages[0].body).toBe('Hello');

      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('/api/tickets/t1');
    });

    it('fetches all messages when no ticketId (loads all tickets first)', async () => {
      // First call: loadTickets
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ tickets: [sampleTicket], total: 1, limit: 200, offset: 0 }),
      );
      // Second call: loadMessages for ticket t1
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ ticket: sampleTicket, messages: [sampleMessage] }),
      );

      const provider = await createProvider();
      const messages = await provider.loadMessages();

      expect(messages).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('loadKBArticles', () => {
    it('unwraps articles from { articles } envelope', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ articles: [sampleArticle], total: 1 }),
      );

      const provider = await createProvider();
      const articles = await provider.loadKBArticles();

      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe('Password reset');
    });
  });

  describe('loadCustomers', () => {
    it('extracts customers from /api/customers response', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ customers: [sampleCustomer], organizations: [sampleOrg] }),
      );

      const provider = await createProvider();
      const customers = await provider.loadCustomers();

      expect(customers).toHaveLength(1);
      expect(customers[0].name).toBe('Alice');
    });
  });

  describe('loadOrganizations', () => {
    it('extracts organizations from /api/customers response', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ customers: [sampleCustomer], organizations: [sampleOrg] }),
      );

      const provider = await createProvider();
      const orgs = await provider.loadOrganizations();

      expect(orgs).toHaveLength(1);
      expect(orgs[0].name).toBe('Acme Inc');
    });
  });

  describe('loadRules', () => {
    it('unwraps rules from { rules } envelope', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ rules: [sampleRule] }),
      );

      const provider = await createProvider();
      const rules = await provider.loadRules();

      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('Auto-prioritize');
    });
  });

  describe('loadCSATRatings', () => {
    it('returns ratings from /api/csat/ratings', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ ratings: [sampleRating] }),
      );

      const provider = await createProvider();
      const ratings = await provider.loadCSATRatings();

      expect(ratings).toHaveLength(1);
      expect(ratings[0].rating).toBe(5);
    });

    it('returns empty array when endpoint is unavailable', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(404, { error: 'Not found' }));

      const provider = await createProvider();
      const ratings = await provider.loadCSATRatings();

      expect(ratings).toEqual([]);
    });
  });

  describe('write operations', () => {
    it('createTicket sends POST to /api/tickets/create', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'new-1', status: 'ok' }));

      const provider = await createProvider();
      const result = await provider.createTicket({
        subject: 'New issue',
        description: 'Something broke',
        priority: 'high',
      });

      expect(result.id).toBe('new-1');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/tickets/create');
      expect(opts.method).toBe('POST');

      const body = JSON.parse(opts.body);
      expect(body.subject).toBe('New issue');
      expect(body.message).toBe('Something broke');
      expect(body.priority).toBe('high');
    });

    it('updateTicket sends PATCH to /api/tickets/:id', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'ok', updated: { status: 'solved' } }));

      const provider = await createProvider();
      await provider.updateTicket('t1', { status: 'solved' });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/tickets/t1');
      expect(opts.method).toBe('PATCH');
    });

    it('createMessage sends POST to /api/tickets/:id/reply', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'ok' }));

      const provider = await createProvider();
      const result = await provider.createMessage({
        ticketId: 't1',
        body: 'Thanks for reaching out',
        visibility: 'public',
      });

      expect(result.id).toBeTruthy();

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/tickets/t1/reply');
      expect(opts.method).toBe('POST');

      const body = JSON.parse(opts.body);
      expect(body.message).toBe('Thanks for reaching out');
      expect(body.isNote).toBe(false);
    });

    it('createMessage sets isNote=true for internal visibility', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'ok' }));

      const provider = await createProvider();
      await provider.createMessage({
        ticketId: 't1',
        body: 'Internal note',
        visibility: 'internal',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.isNote).toBe(true);
    });

    it('createKBArticle sends POST to /api/kb and unwraps response', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ article: { id: 'kb-new', title: 'Test' } }),
      );

      const provider = await createProvider();
      const result = await provider.createKBArticle({
        title: 'Test',
        body: 'Article body',
      });

      expect(result.id).toBe('kb-new');
    });
  });

  describe('error handling', () => {
    it('throws on auth errors with helpful message', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401));

      const provider = await createProvider();
      await expect(provider.loadTickets()).rejects.toThrow('Authentication failed (401)');
    });

    it('throws on 403 with helpful message', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(403));

      const provider = await createProvider();
      await expect(provider.loadTickets()).rejects.toThrow('Authentication failed (403)');
    });

    it('includes server error detail in error message', async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(500, { error: 'Database connection failed' }),
      );

      const provider = await createProvider();
      await expect(provider.loadTickets()).rejects.toThrow('Database connection failed');
    });

    it('throws on network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const provider = await createProvider();
      await expect(provider.loadTickets()).rejects.toThrow('Network error');
    });

    it('throws on non-JSON responses', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('<html>Not Found</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      );

      const provider = await createProvider();
      await expect(provider.loadTickets()).rejects.toThrow('Unexpected content-type');
    });

    it('sends Authorization header when API key is set', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ tickets: [], total: 0, limit: 200, offset: 0 }),
      );

      const provider = await createProvider();
      await provider.loadTickets();

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer test-key-123');
    });

    it('omits Authorization header when no API key', async () => {
      vi.stubEnv('CLIAAS_HOSTED_API_KEY', '');

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ tickets: [], total: 0, limit: 200, offset: 0 }),
      );

      const provider = await createProvider();
      await provider.loadTickets();

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBeUndefined();
    });
  });

  describe('URL encoding', () => {
    it('encodes ticketId in URL path', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ ticket: sampleTicket, messages: [] }),
      );

      const provider = await createProvider();
      await provider.loadMessages('ticket/with/slashes');

      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('ticket%2Fwith%2Fslashes');
    });
  });
});
