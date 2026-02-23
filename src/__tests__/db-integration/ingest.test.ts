/**
 * DB integration tests for the ingest pipeline.
 * Requires a running Postgres with DATABASE_URL set.
 * Run: pnpm test:db
 */

import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { ingestZendeskData, type IngestData } from '@/lib/zendesk/ingest';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('ingest pipeline', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('ingests demo data end-to-end', async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    const data: IngestData = {
      tickets: [
        {
          id: 'ingest-test-1',
          externalId: 'ext-ingest-1',
          source: 'zendesk',
          subject: 'Ingest test ticket',
          status: 'open',
          priority: 'high',
          requester: 'cust-ext-1',
          tags: ['integration-test'],
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      ],
      messages: [
        {
          id: 'msg-ingest-1',
          ticketId: 'ingest-test-1',
          author: 'cust-ext-1',
          body: 'Test message body',
          type: 'reply',
          createdAt: '2024-01-01T01:00:00Z',
        },
      ],
      customers: [
        {
          id: 'cust-ingest-1',
          externalId: 'cust-ext-1',
          source: 'zendesk',
          name: 'Ingest Customer',
          email: 'ingest@test.com',
        },
      ],
      organizations: [
        {
          id: 'org-ingest-1',
          externalId: 'org-ext-1',
          source: 'zendesk',
          name: 'Ingest Org',
          domains: ['ingest-test.com'],
        },
      ],
      kbArticles: [
        {
          id: 'kb-ingest-1',
          externalId: 'kb-ext-1',
          source: 'zendesk',
          title: 'Ingest KB Article',
          body: 'Test KB content',
          categoryPath: ['Testing'],
        },
      ],
      rules: [],
      groups: [],
      customFields: [],
      views: [],
      slaPolicies: [],
      ticketForms: [],
      brands: [],
      auditEvents: [],
      csatRatings: [],
      timeEntries: [],
    };

    await ingestZendeskData({
      tenant: 'ingest-test',
      workspace: 'ingest-test-ws',
      data,
    });

    // Verify data was ingested
    const tickets = await db
      .select()
      .from(schema.tickets)
      .innerJoin(
        schema.workspaces,
        eq(schema.workspaces.id, schema.tickets.workspaceId),
      );
    const ingestTicket = tickets.find(
      (t) => t.tickets.subject === 'Ingest test ticket',
    );
    expect(ingestTicket).toBeDefined();
    expect(ingestTicket?.tickets.priority).toBe('high');

    // Verify KB article
    const articles = await db.select().from(schema.kbArticles);
    const ingestArticle = articles.find(
      (a) => a.title === 'Ingest KB Article',
    );
    expect(ingestArticle).toBeDefined();

    // Verify customer
    const customers = await db.select().from(schema.customers);
    const ingestCustomer = customers.find(
      (c) => c.email === 'ingest@test.com',
    );
    expect(ingestCustomer).toBeDefined();
  });

  it('is idempotent (re-ingest same data)', async () => {
    const data: IngestData = {
      tickets: [
        {
          id: 'ingest-test-1',
          externalId: 'ext-ingest-1',
          source: 'zendesk',
          subject: 'Ingest test ticket UPDATED',
          status: 'solved',
          priority: 'high',
          requester: 'cust-ext-1',
          tags: ['integration-test'],
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-03T00:00:00Z',
        },
      ],
      messages: [],
      customers: [
        {
          id: 'cust-ingest-1',
          externalId: 'cust-ext-1',
          source: 'zendesk',
          name: 'Ingest Customer Updated',
          email: 'ingest@test.com',
        },
      ],
      organizations: [],
      kbArticles: [],
      rules: [],
      groups: [],
      customFields: [],
      views: [],
      slaPolicies: [],
      ticketForms: [],
      brands: [],
      auditEvents: [],
      csatRatings: [],
      timeEntries: [],
    };

    // Should not throw on re-ingest
    await ingestZendeskData({
      tenant: 'ingest-test',
      workspace: 'ingest-test-ws',
      data,
    });

    // Verify it updated rather than duplicated
    const tickets = await db
      .select()
      .from(schema.tickets)
      .innerJoin(
        schema.workspaces,
        eq(schema.workspaces.id, schema.tickets.workspaceId),
      );
    const matching = tickets.filter(
      (t) => t.tickets.subject.includes('Ingest test ticket'),
    );
    // Should have exactly one ticket (updated, not duplicated)
    expect(matching.length).toBe(1);
    expect(matching[0].tickets.subject).toBe('Ingest test ticket UPDATED');
    expect(matching[0].tickets.status).toBe('solved');
  });
});
