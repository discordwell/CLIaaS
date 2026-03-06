import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Status Mapper tests ----
describe('status-mapper', () => {
  let mapToCliaas: typeof import('@/lib/integrations/status-mapper').mapToCliaas;
  let mapFromCliaas: typeof import('@/lib/integrations/status-mapper').mapFromCliaas;
  let getDefaultMappings: typeof import('@/lib/integrations/status-mapper').getDefaultMappings;

  beforeEach(async () => {
    const mod = await import('@/lib/integrations/status-mapper');
    mapToCliaas = mod.mapToCliaas;
    mapFromCliaas = mod.mapFromCliaas;
    getDefaultMappings = mod.getDefaultMappings;
  });

  it('maps Jira statuses to CLIaaS', () => {
    expect(mapToCliaas('jira', 'To Do')).toBe('open');
    expect(mapToCliaas('jira', 'In Progress')).toBe('pending');
    expect(mapToCliaas('jira', 'Done')).toBe('solved');
  });

  it('maps CLIaaS statuses to Jira', () => {
    expect(mapFromCliaas('jira', 'open')).toBe('To Do');
    expect(mapFromCliaas('jira', 'pending')).toBe('In Progress');
    expect(mapFromCliaas('jira', 'solved')).toBe('Done');
  });

  it('maps Linear statuses to CLIaaS', () => {
    expect(mapToCliaas('linear', 'Todo')).toBe('open');
    expect(mapToCliaas('linear', 'In Progress')).toBe('pending');
    expect(mapToCliaas('linear', 'Done')).toBe('solved');
  });

  it('maps GitHub statuses to CLIaaS', () => {
    expect(mapToCliaas('github', 'open')).toBe('open');
    expect(mapToCliaas('github', 'closed')).toBe('solved');
  });

  it('returns null for unknown external statuses', () => {
    expect(mapToCliaas('jira', 'some-unknown-status')).toBeNull();
  });

  it('returns null for unknown CLIaaS statuses', () => {
    const result = mapFromCliaas('jira', 'some-unknown-status' as 'open');
    expect(result).toBeNull();
  });

  it('provides default mappings for each provider', () => {
    expect(getDefaultMappings('jira').length).toBeGreaterThan(0);
    expect(getDefaultMappings('linear').length).toBeGreaterThan(0);
    expect(getDefaultMappings('github').length).toBeGreaterThan(0);
    expect(getDefaultMappings('unknown')).toHaveLength(0);
  });
});

// ---- Custom Objects Store tests ----
describe('custom-objects', () => {
  let customObjects: typeof import('@/lib/custom-objects');

  beforeEach(async () => {
    vi.resetModules();
    // Mock the JSONL store to avoid file I/O
    vi.mock('@/lib/jsonl-store', () => ({
      readJsonlFile: () => [],
      writeJsonlFile: () => {},
    }));
    customObjects = await import('@/lib/custom-objects');
  });

  it('creates and retrieves object types', () => {
    const type = customObjects.createObjectType({
      workspaceId: 'ws-1',
      key: 'subscription',
      name: 'Subscription',
      namePlural: 'Subscriptions',
      description: 'Customer subscriptions',
      fields: [
        { key: 'plan', name: 'Plan', type: 'select', required: true, options: ['free', 'pro', 'enterprise'] },
        { key: 'mrr', name: 'Monthly Revenue', type: 'currency' },
        { key: 'active', name: 'Active', type: 'boolean' },
      ],
    });

    expect(type.id).toBeDefined();
    expect(type.key).toBe('subscription');
    expect(type.fields).toHaveLength(3);

    const found = customObjects.getObjectTypeByKey('ws-1', 'subscription');
    expect(found?.id).toBe(type.id);

    const all = customObjects.listObjectTypes('ws-1');
    expect(all).toHaveLength(1);
  });

  it('prevents duplicate type keys in same workspace', () => {
    customObjects.createObjectType({
      workspaceId: 'ws-1',
      key: 'dup-test',
      name: 'Dup Test',
      namePlural: 'Dup Tests',
      fields: [],
    });

    expect(() => customObjects.createObjectType({
      workspaceId: 'ws-1',
      key: 'dup-test',
      name: 'Dup Again',
      namePlural: 'Dup Agains',
      fields: [],
    })).toThrow('already exists');
  });

  it('creates and queries records', () => {
    const type = customObjects.createObjectType({
      workspaceId: 'ws-1',
      key: 'product',
      name: 'Product',
      namePlural: 'Products',
      fields: [
        { key: 'name', name: 'Name', type: 'text', required: true },
        { key: 'price', name: 'Price', type: 'currency' },
      ],
    });

    const rec1 = customObjects.createRecord({
      workspaceId: 'ws-1',
      typeId: type.id,
      data: { name: 'Widget', price: 9.99 },
    });

    const rec2 = customObjects.createRecord({
      workspaceId: 'ws-1',
      typeId: type.id,
      data: { name: 'Gadget', price: 19.99 },
    });

    const records = customObjects.listRecords(type.id);
    expect(records).toHaveLength(2);

    const found = customObjects.getRecord(rec1.id);
    expect(found?.data.name).toBe('Widget');

    const updated = customObjects.updateRecord(rec2.id, { data: { name: 'Gadget Pro', price: 29.99 } });
    expect(updated?.data.name).toBe('Gadget Pro');
  });

  it('validates record data against type schema', () => {
    const type = customObjects.createObjectType({
      workspaceId: 'ws-1',
      key: 'validated',
      name: 'Validated',
      namePlural: 'Validateds',
      fields: [
        { key: 'email', name: 'Email', type: 'email', required: true },
        { key: 'count', name: 'Count', type: 'number' },
        { key: 'tier', name: 'Tier', type: 'select', options: ['a', 'b', 'c'] },
      ],
    });

    // Missing required field
    const v1 = customObjects.validateRecordData(type, { count: 5 });
    expect(v1.valid).toBe(false);
    expect(v1.errors).toContain('Email is required');

    // Wrong type
    const v2 = customObjects.validateRecordData(type, { email: 123 as unknown as string });
    expect(v2.valid).toBe(false);

    // Invalid select option
    const v3 = customObjects.validateRecordData(type, { email: 'test@test.com', tier: 'invalid' });
    expect(v3.valid).toBe(false);

    // Valid
    const v4 = customObjects.validateRecordData(type, { email: 'ok@ok.com', count: 42, tier: 'b' });
    expect(v4.valid).toBe(true);
    expect(v4.errors).toHaveLength(0);
  });

  it('manages relationships', () => {
    const rel = customObjects.createRelationship({
      workspaceId: 'ws-1',
      sourceType: 'ticket',
      sourceId: 'ticket-1',
      targetType: 'custom_object',
      targetId: 'rec-1',
      relationshipType: 'related',
      metadata: {},
    });

    expect(rel.id).toBeDefined();

    // Query as source
    const asSource = customObjects.listRelationships({ sourceType: 'ticket', sourceId: 'ticket-1' });
    expect(asSource).toHaveLength(1);

    // Query as target
    const asTarget = customObjects.listRelationships({ targetType: 'custom_object', targetId: 'rec-1' });
    expect(asTarget).toHaveLength(1);

    // Prevent duplicate
    expect(() => customObjects.createRelationship({
      workspaceId: 'ws-1',
      sourceType: 'ticket',
      sourceId: 'ticket-1',
      targetType: 'custom_object',
      targetId: 'rec-1',
      relationshipType: 'parent',
      metadata: {},
    })).toThrow('already exists');

    // Delete
    expect(customObjects.deleteRelationship(rel.id)).toBe(true);
    expect(customObjects.listRelationships({ sourceType: 'ticket', sourceId: 'ticket-1' })).toHaveLength(0);
  });

  it('cascades record deletion to relationships', () => {
    const type = customObjects.createObjectType({
      workspaceId: 'ws-1',
      key: 'cascade-test',
      name: 'Cascade',
      namePlural: 'Cascades',
      fields: [],
    });

    const rec = customObjects.createRecord({
      workspaceId: 'ws-1',
      typeId: type.id,
      data: {},
    });

    customObjects.createRelationship({
      workspaceId: 'ws-1',
      sourceType: 'custom_object',
      sourceId: rec.id,
      targetType: 'ticket',
      targetId: 'ticket-99',
      relationshipType: 'related',
      metadata: {},
    });

    customObjects.deleteRecord(rec.id);

    const rels = customObjects.listRelationships({ sourceType: 'custom_object', sourceId: rec.id });
    expect(rels).toHaveLength(0);
  });

  it('cascades type deletion to records', () => {
    const type = customObjects.createObjectType({
      workspaceId: 'ws-1',
      key: 'type-cascade',
      name: 'TypeCascade',
      namePlural: 'TypeCascades',
      fields: [],
    });

    customObjects.createRecord({ workspaceId: 'ws-1', typeId: type.id, data: { a: 1 } });
    customObjects.createRecord({ workspaceId: 'ws-1', typeId: type.id, data: { a: 2 } });

    expect(customObjects.listRecords(type.id)).toHaveLength(2);

    customObjects.deleteObjectType(type.id);

    expect(customObjects.listRecords(type.id)).toHaveLength(0);
    expect(customObjects.getObjectType(type.id)).toBeUndefined();
  });
});

// ---- Link Store tests ----
describe('link-store', () => {
  let linkStore: typeof import('@/lib/integrations/link-store');

  beforeEach(async () => {
    vi.resetModules();
    vi.mock('@/lib/jsonl-store', () => ({
      readJsonlFile: () => [],
      writeJsonlFile: () => {},
    }));
    linkStore = await import('@/lib/integrations/link-store');
  });

  it('creates and lists external links', () => {
    const link = linkStore.createExternalLink({
      workspaceId: 'ws-1',
      ticketId: 'ticket-1',
      provider: 'jira',
      externalId: 'PROJ-123',
      externalUrl: 'https://jira.example.com/browse/PROJ-123',
      externalStatus: 'To Do',
      externalTitle: 'Fix bug',
      direction: 'outbound',
      metadata: {},
      syncEnabled: true,
    });

    expect(link.id).toBeDefined();
    expect(link.provider).toBe('jira');

    const links = linkStore.listExternalLinks('ticket-1');
    expect(links).toHaveLength(1);
    expect(links[0].externalId).toBe('PROJ-123');
  });

  it('manages credentials', () => {
    linkStore.saveCredentials({
      workspaceId: 'ws-1',
      provider: 'jira',
      authType: 'api_token',
      credentials: { baseUrl: 'https://x.atlassian.net', email: 'a@b.com', apiToken: 'tok' },
      scopes: ['read', 'write'],
    });

    const creds = linkStore.getCredentials('ws-1', 'jira');
    expect(creds).toBeDefined();
    expect(creds?.provider).toBe('jira');
    expect((creds?.credentials as Record<string, string>).baseUrl).toBe('https://x.atlassian.net');

    linkStore.deleteCredentials('ws-1', 'jira');
    expect(linkStore.getCredentials('ws-1', 'jira')).toBeUndefined();
  });

  it('creates and lists CRM links', () => {
    const link = linkStore.createCrmLink({
      workspaceId: 'ws-1',
      provider: 'salesforce',
      entityType: 'customer',
      entityId: 'cust-1',
      crmObjectType: 'Contact',
      crmObjectId: '003xxxx',
      crmObjectUrl: 'https://sf.com/003xxxx',
      crmData: { Name: 'John Smith', Title: 'CTO' },
    });

    expect(link.id).toBeDefined();

    const links = linkStore.listCrmLinks('customer', 'cust-1');
    expect(links).toHaveLength(1);
    expect(links[0].crmData.Name).toBe('John Smith');

    linkStore.deleteCrmLink(link.id);
    expect(linkStore.listCrmLinks('customer', 'cust-1')).toHaveLength(0);
  });
});
