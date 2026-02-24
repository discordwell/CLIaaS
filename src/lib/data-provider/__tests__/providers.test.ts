import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JsonlProvider } from '../jsonl-provider';
import { getDataProvider, resetDataProvider, detectDataMode } from '../index';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'cliaas-provider-test');

function writeJsonl(filename: string, records: unknown[]) {
  writeFileSync(join(TEST_DIR, filename), records.map(r => JSON.stringify(r)).join('\n') + '\n');
}

describe('DataProvider', () => {
  describe('detectDataMode', () => {
    const origEnv = process.env;

    beforeEach(() => {
      vi.stubEnv('CLIAAS_MODE', '');
      vi.stubEnv('DATABASE_URL', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('defaults to local when no env set', () => {
      expect(detectDataMode()).toBe('local');
    });

    it('returns db when DATABASE_URL is set', () => {
      vi.stubEnv('DATABASE_URL', 'postgresql://localhost/test');
      expect(detectDataMode()).toBe('db');
    });

    it('respects explicit CLIAAS_MODE', () => {
      vi.stubEnv('CLIAAS_MODE', 'remote');
      expect(detectDataMode()).toBe('remote');
    });

    it('CLIAAS_MODE takes precedence over DATABASE_URL', () => {
      vi.stubEnv('CLIAAS_MODE', 'local');
      vi.stubEnv('DATABASE_URL', 'postgresql://localhost/test');
      expect(detectDataMode()).toBe('local');
    });
  });

  describe('JsonlProvider', () => {
    beforeEach(() => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'manifest.json'), '{}');
    });

    afterEach(() => {
      rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('loads tickets from JSONL', async () => {
      writeJsonl('tickets.jsonl', [
        {
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
        },
      ]);

      const provider = new JsonlProvider(TEST_DIR);
      const tickets = await provider.loadTickets();
      expect(tickets).toHaveLength(1);
      expect(tickets[0].subject).toBe('Help needed');
      expect(tickets[0].tags).toEqual(['billing']);
    });

    it('loads messages from JSONL', async () => {
      writeJsonl('messages.jsonl', [
        { id: 'm1', ticketId: 't1', author: 'alice', body: 'Hello', type: 'reply', createdAt: '2026-01-01T00:00:00Z' },
        { id: 'm2', ticketId: 't2', author: 'bob', body: 'Hi', type: 'note', createdAt: '2026-01-01T00:00:00Z' },
      ]);

      const provider = new JsonlProvider(TEST_DIR);

      const all = await provider.loadMessages();
      expect(all).toHaveLength(2);

      const filtered = await provider.loadMessages('t1');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].author).toBe('alice');
    });

    it('loads KB articles from JSONL', async () => {
      writeJsonl('kb_articles.jsonl', [
        { id: 'kb1', title: 'Reset password', body: 'Go to settings...', categoryPath: ['Account'] },
      ]);

      const provider = new JsonlProvider(TEST_DIR);
      const articles = await provider.loadKBArticles();
      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe('Reset password');
    });

    it('returns empty arrays for missing files', async () => {
      const provider = new JsonlProvider(TEST_DIR);
      expect(await provider.loadTickets()).toEqual([]);
      expect(await provider.loadMessages()).toEqual([]);
      expect(await provider.loadKBArticles()).toEqual([]);
      expect(await provider.loadCustomers()).toEqual([]);
      expect(await provider.loadOrganizations()).toEqual([]);
      expect(await provider.loadRules()).toEqual([]);
      expect(await provider.loadCSATRatings()).toEqual([]);
    });

    it('reports correct capabilities', () => {
      const provider = new JsonlProvider();
      expect(provider.capabilities.mode).toBe('local');
      expect(provider.capabilities.supportsWrite).toBe(false);
      expect(provider.capabilities.supportsSync).toBe(false);
    });

    it('throws on write operations', async () => {
      const provider = new JsonlProvider();
      await expect(provider.createTicket({ subject: 'test' })).rejects.toThrow('Write operations require a database');
      await expect(provider.updateTicket('t1', { status: 'closed' })).rejects.toThrow('Write operations require a database');
      await expect(provider.createMessage({ ticketId: 't1', body: 'hi' })).rejects.toThrow('Write operations require a database');
      await expect(provider.createKBArticle({ title: 'test', body: 'body' })).rejects.toThrow('Write operations require a database');
    });

    it('deduplicates entries by id', async () => {
      writeJsonl('tickets.jsonl', [
        { id: 't1', externalId: '100', source: 'zendesk', subject: 'Dup1', status: 'open', priority: 'normal', requester: 'a', tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 't1', externalId: '100', source: 'zendesk', subject: 'Dup2', status: 'open', priority: 'normal', requester: 'a', tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ]);

      const provider = new JsonlProvider(TEST_DIR);
      const tickets = await provider.loadTickets();
      expect(tickets).toHaveLength(1);
      expect(tickets[0].subject).toBe('Dup1');
    });
  });

  describe('getDataProvider factory', () => {
    afterEach(() => {
      resetDataProvider();
      vi.unstubAllEnvs();
    });

    it('returns JsonlProvider for local mode', async () => {
      vi.stubEnv('CLIAAS_MODE', 'local');
      vi.stubEnv('DATABASE_URL', '');
      const provider = await getDataProvider();
      expect(provider.capabilities.mode).toBe('local');
    });

    it('returns a fresh provider when dir override is given', async () => {
      vi.stubEnv('CLIAAS_MODE', 'local');
      vi.stubEnv('DATABASE_URL', '');
      const p1 = await getDataProvider();
      const p2 = await getDataProvider('/some/dir');
      // p2 should be a different instance because of dir override
      expect(p1).not.toBe(p2);
    });

    it('caches the provider for same mode', async () => {
      vi.stubEnv('CLIAAS_MODE', 'local');
      vi.stubEnv('DATABASE_URL', '');
      const p1 = await getDataProvider();
      const p2 = await getDataProvider();
      expect(p1).toBe(p2);
    });
  });
});
