import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('seedWorkspaceWithSampleData', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DATABASE_URL = 'postgres://fake';
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  function mockDbWithResults(...results: unknown[][]) {
    let callIndex = 0;
    return {
      db: {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(() => {
                const result = results[callIndex] ?? [];
                callIndex++;
                return Promise.resolve(result);
              }),
            }),
          }),
        })),
      },
    };
  }

  const schemaStub = {
    tenants: { id: 'id', name: 'name' },
    workspaces: { id: 'id', name: 'name' },
  };

  it('resolves tenant/workspace names and calls ingestZendeskExportDir', async () => {
    const mockIngest = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/db', () => mockDbWithResults(
      [{ name: 'acme-corp' }],       // tenant lookup
      [{ name: 'acme-workspace' }],   // workspace lookup
    ));
    vi.doMock('@/db/schema', () => schemaStub);
    vi.doMock('@/lib/zendesk/ingest', () => ({
      ingestZendeskExportDir: mockIngest,
    }));

    const { seedWorkspaceWithSampleData } = await import('@/lib/onboarding/seed-sample-data');
    await seedWorkspaceWithSampleData({ tenantId: 't1', workspaceId: 'ws1' });

    expect(mockIngest).toHaveBeenCalledOnce();
    const call = mockIngest.mock.calls[0][0];
    expect(call.tenant).toBe('acme-corp');
    expect(call.workspace).toBe('acme-workspace');
    expect(call.dir).toContain('fixtures/demo-data');
  });

  it('throws if tenant not found', async () => {
    vi.doMock('@/db', () => mockDbWithResults([]));
    vi.doMock('@/db/schema', () => schemaStub);

    const { seedWorkspaceWithSampleData } = await import('@/lib/onboarding/seed-sample-data');
    await expect(
      seedWorkspaceWithSampleData({ tenantId: 'bad', workspaceId: 'ws1' })
    ).rejects.toThrow('Tenant bad not found');
  });

  it('throws if workspace not found', async () => {
    vi.doMock('@/db', () => mockDbWithResults(
      [{ name: 'acme' }],  // tenant found
      [],                    // workspace not found
    ));
    vi.doMock('@/db/schema', () => schemaStub);

    const { seedWorkspaceWithSampleData } = await import('@/lib/onboarding/seed-sample-data');
    await expect(
      seedWorkspaceWithSampleData({ tenantId: 't1', workspaceId: 'bad' })
    ).rejects.toThrow('Workspace bad not found');
  });
});

describe('demo-data fixtures integrity', () => {
  const demoDir = join(process.cwd(), 'fixtures', 'demo-data');

  it('fixtures directory and manifest exist', () => {
    expect(existsSync(demoDir)).toBe(true);
    expect(existsSync(join(demoDir, 'manifest.json'))).toBe(true);
  });

  it('manifest counts match actual JSONL line counts', () => {
    const manifest = JSON.parse(readFileSync(join(demoDir, 'manifest.json'), 'utf-8'));
    const fileMap: Record<string, string> = {
      tickets: 'tickets.jsonl',
      messages: 'messages.jsonl',
      customers: 'customers.jsonl',
      organizations: 'organizations.jsonl',
      kbArticles: 'kb_articles.jsonl',
      rules: 'rules.jsonl',
    };

    for (const [key, file] of Object.entries(fileMap)) {
      const path = join(demoDir, file);
      if (!existsSync(path)) continue;
      const lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.trim());
      expect(lines.length, `${file} should have ${manifest.counts[key]} records`).toBe(manifest.counts[key]);
    }
  });

  it('all JSONL files contain valid JSON on each line', () => {
    const files = ['tickets.jsonl', 'messages.jsonl', 'customers.jsonl',
      'organizations.jsonl', 'kb_articles.jsonl', 'rules.jsonl'];
    for (const file of files) {
      const path = join(demoDir, file);
      if (!existsSync(path)) continue;
      const lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.trim());
      for (const [i, line] of lines.entries()) {
        expect(() => JSON.parse(line), `${file}:${i + 1} should be valid JSON`).not.toThrow();
      }
    }
  });

  it('ticket requester references match customer externalIds', () => {
    const customers = readFileSync(join(demoDir, 'customers.jsonl'), 'utf-8')
      .split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const tickets = readFileSync(join(demoDir, 'tickets.jsonl'), 'utf-8')
      .split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

    const customerExternalIds = new Set(customers.map((c: { externalId: string }) => c.externalId));

    for (const ticket of tickets) {
      expect(
        customerExternalIds.has(ticket.requester),
        `Ticket ${ticket.id} requester "${ticket.requester}" should be a valid customer externalId`
      ).toBe(true);
    }
  });

  it('customer orgId references match organization externalIds', () => {
    const orgs = readFileSync(join(demoDir, 'organizations.jsonl'), 'utf-8')
      .split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const customers = readFileSync(join(demoDir, 'customers.jsonl'), 'utf-8')
      .split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

    const orgExternalIds = new Set(orgs.map((o: { externalId: string }) => o.externalId));

    for (const customer of customers) {
      if (customer.orgId) {
        expect(
          orgExternalIds.has(customer.orgId),
          `Customer ${customer.id} orgId "${customer.orgId}" should be a valid org externalId`
        ).toBe(true);
      }
    }
  });

  it('ticket assignee values are present as customer externalIds', () => {
    const customers = readFileSync(join(demoDir, 'customers.jsonl'), 'utf-8')
      .split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const tickets = readFileSync(join(demoDir, 'tickets.jsonl'), 'utf-8')
      .split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

    const customerExternalIds = new Set(customers.map((c: { externalId: string }) => c.externalId));
    const assigneeIds = new Set(
      tickets.flatMap((t: { assignee?: string }) => t.assignee ? [t.assignee] : []),
    );

    for (const assignee of assigneeIds) {
      expect(
        customerExternalIds.has(assignee),
        `Ticket assignee "${assignee}" should be a valid customer externalId`
      ).toBe(true);
    }
  });

  it('all tickets have updatedAt >= createdAt', () => {
    const tickets = readFileSync(join(demoDir, 'tickets.jsonl'), 'utf-8')
      .split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

    for (const ticket of tickets) {
      const created = new Date(ticket.createdAt).getTime();
      const updated = new Date(ticket.updatedAt).getTime();
      expect(
        updated >= created,
        `Ticket ${ticket.id} has updatedAt (${ticket.updatedAt}) before createdAt (${ticket.createdAt})`
      ).toBe(true);
    }
  });

  it('message authors reference customer or agent externalIds', () => {
    const customers = readFileSync(join(demoDir, 'customers.jsonl'), 'utf-8')
      .split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const tickets = readFileSync(join(demoDir, 'tickets.jsonl'), 'utf-8')
      .split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const messages = readFileSync(join(demoDir, 'messages.jsonl'), 'utf-8')
      .split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

    const customerExternalIds = new Set(customers.map((c: { externalId: string }) => c.externalId));
    const agentExternalIds = new Set<string>();
    for (const t of tickets) {
      if (t.assignee) agentExternalIds.add(t.assignee);
    }

    const validIds = new Set([...customerExternalIds, ...agentExternalIds]);

    for (const msg of messages) {
      expect(
        validIds.has(msg.author),
        `Message ${msg.id} author "${msg.author}" should be a valid customer/agent externalId`
      ).toBe(true);
    }
  });
});
