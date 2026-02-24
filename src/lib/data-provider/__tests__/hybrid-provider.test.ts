import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Ticket,
  Message,
  KBArticle,
  TicketCreateParams,
  TicketUpdateParams,
  MessageCreateParams,
  KBArticleCreateParams,
} from '../types';

// ---- Mock DbProvider as a class ----

const mockLoadTickets = vi.fn();
const mockLoadMessages = vi.fn();
const mockLoadKBArticles = vi.fn();
const mockLoadCustomers = vi.fn();
const mockLoadOrganizations = vi.fn();
const mockLoadRules = vi.fn();
const mockLoadCSATRatings = vi.fn();
const mockCreateTicket = vi.fn();
const mockUpdateTicket = vi.fn();
const mockCreateMessage = vi.fn();
const mockCreateKBArticle = vi.fn();

vi.mock('../db-provider', () => ({
  DbProvider: class MockDbProvider {
    capabilities = { mode: 'db' as const, supportsWrite: true, supportsSync: true, supportsRag: true };
    loadTickets = mockLoadTickets;
    loadMessages = mockLoadMessages;
    loadKBArticles = mockLoadKBArticles;
    loadCustomers = mockLoadCustomers;
    loadOrganizations = mockLoadOrganizations;
    loadRules = mockLoadRules;
    loadCSATRatings = mockLoadCSATRatings;
    createTicket = mockCreateTicket;
    updateTicket = mockUpdateTicket;
    createMessage = mockCreateMessage;
    createKBArticle = mockCreateKBArticle;
  },
}));

// Mock drizzle-orm (needed by hybrid-provider imports)
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

// Mock DB module — the outbox insert path needs this, but for unit tests
// we mainly verify the DbProvider delegation. Outbox inserts are tested
// separately in the sync integration tests.
vi.mock('@/db', () => ({
  db: {},
}));

vi.mock('@/db/schema', () => ({
  workspaces: { id: 'id', name: 'name', createdAt: 'created_at' },
  syncOutbox: { id: 'id' },
}));

// Sample data
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

describe('HybridProvider', () => {
  let HybridProvider: typeof import('../hybrid-provider').HybridProvider;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Ensure DATABASE_URL is not set so outbox insertion is a no-op
    vi.stubEnv('DATABASE_URL', '');

    const mod = await import('../hybrid-provider');
    HybridProvider = mod.HybridProvider;
    mod.resetOutboxContext();
  });

  describe('capabilities', () => {
    it('reports hybrid mode with full capabilities', () => {
      const provider = new HybridProvider();
      expect(provider.capabilities.mode).toBe('hybrid');
      expect(provider.capabilities.supportsWrite).toBe(true);
      expect(provider.capabilities.supportsSync).toBe(true);
      expect(provider.capabilities.supportsRag).toBe(true);
    });
  });

  describe('reads delegate to DbProvider', () => {
    it('loadTickets delegates to local DbProvider', async () => {
      mockLoadTickets.mockResolvedValueOnce([sampleTicket]);

      const provider = new HybridProvider();
      const tickets = await provider.loadTickets();

      expect(tickets).toEqual([sampleTicket]);
      expect(mockLoadTickets).toHaveBeenCalledTimes(1);
    });

    it('loadMessages with ticketId delegates to local DbProvider', async () => {
      mockLoadMessages.mockResolvedValueOnce([sampleMessage]);

      const provider = new HybridProvider();
      const messages = await provider.loadMessages('t1');

      expect(messages).toEqual([sampleMessage]);
      expect(mockLoadMessages).toHaveBeenCalledWith('t1');
    });

    it('loadMessages without ticketId delegates correctly', async () => {
      mockLoadMessages.mockResolvedValueOnce([sampleMessage]);

      const provider = new HybridProvider();
      await provider.loadMessages();

      expect(mockLoadMessages).toHaveBeenCalledWith(undefined);
    });

    it('loadKBArticles delegates to local DbProvider', async () => {
      mockLoadKBArticles.mockResolvedValueOnce([sampleArticle]);

      const provider = new HybridProvider();
      const articles = await provider.loadKBArticles();

      expect(articles).toEqual([sampleArticle]);
      expect(mockLoadKBArticles).toHaveBeenCalledTimes(1);
    });

    it('loadCustomers delegates to local DbProvider', async () => {
      mockLoadCustomers.mockResolvedValueOnce([]);

      const provider = new HybridProvider();
      const customers = await provider.loadCustomers();

      expect(customers).toEqual([]);
      expect(mockLoadCustomers).toHaveBeenCalledTimes(1);
    });

    it('loadOrganizations delegates to local DbProvider', async () => {
      mockLoadOrganizations.mockResolvedValueOnce([]);

      const provider = new HybridProvider();
      const orgs = await provider.loadOrganizations();

      expect(orgs).toEqual([]);
      expect(mockLoadOrganizations).toHaveBeenCalledTimes(1);
    });

    it('loadRules delegates to local DbProvider', async () => {
      mockLoadRules.mockResolvedValueOnce([]);

      const provider = new HybridProvider();
      const rules = await provider.loadRules();

      expect(rules).toEqual([]);
      expect(mockLoadRules).toHaveBeenCalledTimes(1);
    });

    it('loadCSATRatings delegates to local DbProvider', async () => {
      mockLoadCSATRatings.mockResolvedValueOnce([]);

      const provider = new HybridProvider();
      const ratings = await provider.loadCSATRatings();

      expect(ratings).toEqual([]);
      expect(mockLoadCSATRatings).toHaveBeenCalledTimes(1);
    });
  });

  describe('writes go to DbProvider and return results', () => {
    it('createTicket writes to local DB and returns id', async () => {
      mockCreateTicket.mockResolvedValueOnce({ id: 'new-1' });

      const provider = new HybridProvider();
      const params: TicketCreateParams = { subject: 'Test ticket', priority: 'high' };
      const result = await provider.createTicket(params);

      expect(result.id).toBe('new-1');
      expect(mockCreateTicket).toHaveBeenCalledWith(params);
    });

    it('updateTicket writes to local DB', async () => {
      mockUpdateTicket.mockResolvedValueOnce(undefined);

      const provider = new HybridProvider();
      const params: TicketUpdateParams = { status: 'solved' };
      await provider.updateTicket('t1', params);

      expect(mockUpdateTicket).toHaveBeenCalledWith('t1', params);
    });

    it('createMessage writes to local DB and returns id', async () => {
      mockCreateMessage.mockResolvedValueOnce({ id: 'msg-1' });

      const provider = new HybridProvider();
      const params: MessageCreateParams = { ticketId: 't1', body: 'Hello' };
      const result = await provider.createMessage(params);

      expect(result.id).toBe('msg-1');
      expect(mockCreateMessage).toHaveBeenCalledWith(params);
    });

    it('createKBArticle writes to local DB and returns id', async () => {
      mockCreateKBArticle.mockResolvedValueOnce({ id: 'kb-1' });

      const provider = new HybridProvider();
      const params: KBArticleCreateParams = { title: 'Test', body: 'Content' };
      const result = await provider.createKBArticle(params);

      expect(result.id).toBe('kb-1');
      expect(mockCreateKBArticle).toHaveBeenCalledWith(params);
    });
  });

  describe('write operations attempt outbox insertion', () => {
    // With DATABASE_URL unset, outbox insertion is a no-op (graceful degradation).
    // We verify the DbProvider call still succeeds.
    it('createTicket succeeds even when outbox context is unavailable', async () => {
      mockCreateTicket.mockResolvedValueOnce({ id: 'new-2' });

      const provider = new HybridProvider();
      const result = await provider.createTicket({ subject: 'Offline ticket' });

      expect(result.id).toBe('new-2');
    });

    it('updateTicket succeeds even when outbox context is unavailable', async () => {
      mockUpdateTicket.mockResolvedValueOnce(undefined);

      const provider = new HybridProvider();
      await provider.updateTicket('t1', { status: 'closed' });

      expect(mockUpdateTicket).toHaveBeenCalled();
    });

    it('createMessage succeeds even when outbox context is unavailable', async () => {
      mockCreateMessage.mockResolvedValueOnce({ id: 'msg-2' });

      const provider = new HybridProvider();
      const result = await provider.createMessage({ ticketId: 't1', body: 'test' });

      expect(result.id).toBe('msg-2');
    });

    it('createKBArticle succeeds even when outbox context is unavailable', async () => {
      mockCreateKBArticle.mockResolvedValueOnce({ id: 'kb-2' });

      const provider = new HybridProvider();
      const result = await provider.createKBArticle({ title: 'Article', body: 'Body' });

      expect(result.id).toBe('kb-2');
    });
  });
});
