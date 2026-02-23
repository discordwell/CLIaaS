/**
 * DB integration tests for data.ts loaders.
 * Requires a running Postgres with DATABASE_URL set.
 * Run: pnpm test:db
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;

// Skip all tests if no DATABASE_URL
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('data.ts DB loaders', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let workspaceId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    // Create tenant + workspace for tests
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: 'test-data' })
      .onConflictDoNothing()
      .returning({ id: schema.tenants.id });

    const tenantId = tenant?.id ?? (
      await db.select({ id: schema.tenants.id }).from(schema.tenants).limit(1)
    )[0].id;

    const [ws] = await db
      .insert(schema.workspaces)
      .values({ tenantId, name: 'test-data-ws' })
      .onConflictDoNothing()
      .returning({ id: schema.workspaces.id });

    workspaceId = ws?.id ?? (
      await db.select({ id: schema.workspaces.id }).from(schema.workspaces).limit(1)
    )[0].id;

    // Insert a test ticket
    await db.insert(schema.tickets).values({
      workspaceId,
      subject: 'Test ticket from integration',
      status: 'open',
      priority: 'normal',
      source: 'zendesk',
    });

    // Insert a test KB article
    await db.insert(schema.kbArticles).values({
      workspaceId,
      title: 'Test KB Article',
      body: 'This is a test article.',
      categoryPath: ['Test', 'Integration'],
    });

    // Insert a test customer
    await db.insert(schema.customers).values({
      workspaceId,
      name: 'Test Customer',
      email: 'test@example.com',
    });

    // Insert a test organization
    await db.insert(schema.organizations).values({
      workspaceId,
      name: 'Test Org',
      domains: ['example.com'],
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('loadTickets returns tickets from DB', async () => {
    const { loadTickets } = await import('@/lib/data');
    const tickets = await loadTickets();
    expect(tickets.length).toBeGreaterThan(0);
    const testTicket = tickets.find(t => t.subject === 'Test ticket from integration');
    expect(testTicket).toBeDefined();
    expect(testTicket?.status).toBe('open');
  });

  it('loadKBArticles returns articles from DB', async () => {
    const { loadKBArticles } = await import('@/lib/data');
    const articles = await loadKBArticles();
    expect(articles.length).toBeGreaterThan(0);
    const testArticle = articles.find(a => a.title === 'Test KB Article');
    expect(testArticle).toBeDefined();
    expect(testArticle?.categoryPath).toEqual(['Test', 'Integration']);
  });

  it('loadCustomers returns customers from DB', async () => {
    const { loadCustomers } = await import('@/lib/data');
    const customers = await loadCustomers();
    expect(customers.length).toBeGreaterThan(0);
    const testCustomer = customers.find(c => c.email === 'test@example.com');
    expect(testCustomer).toBeDefined();
  });

  it('loadOrganizations returns organizations from DB', async () => {
    const { loadOrganizations } = await import('@/lib/data');
    const orgs = await loadOrganizations();
    expect(orgs.length).toBeGreaterThan(0);
    const testOrg = orgs.find(o => o.name === 'Test Org');
    expect(testOrg).toBeDefined();
  });
});
