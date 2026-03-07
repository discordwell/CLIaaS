import { describe, it, expect } from 'vitest';
import { ALL_CONNECTOR_IDS, type ConnectorId } from '@/lib/connector-registry';
import { getEntityCapabilities, getAllEntityCapabilities, type EntityCapabilities } from '@/lib/connector-service';

const ENTITY_KEYS: (keyof EntityCapabilities)[] = [
  'tickets', 'messages', 'customers', 'organizations', 'kbArticles', 'rules', 'conversations',
];

describe('entity capability matrix', () => {
  it('has an entry for every registered connector', () => {
    for (const id of ALL_CONNECTOR_IDS) {
      const caps = getEntityCapabilities(id);
      expect(caps).toBeDefined();
    }
  });

  it('getAllEntityCapabilities returns all connectors', () => {
    const all = getAllEntityCapabilities();
    for (const id of ALL_CONNECTOR_IDS) {
      expect(all[id]).toBeDefined();
    }
    expect(Object.keys(all)).toHaveLength(ALL_CONNECTOR_IDS.length);
  });

  it('every entity capability entry has all required entity keys', () => {
    for (const id of ALL_CONNECTOR_IDS) {
      const caps = getEntityCapabilities(id);
      for (const key of ENTITY_KEYS) {
        expect(caps[key]).toBeDefined();
      }
    }
  });

  it('tickets have read/create/update/delete booleans', () => {
    for (const id of ALL_CONNECTOR_IDS) {
      const t = getEntityCapabilities(id).tickets;
      expect(typeof t.read).toBe('boolean');
      expect(typeof t.create).toBe('boolean');
      expect(typeof t.update).toBe('boolean');
      expect(typeof t.delete).toBe('boolean');
    }
  });

  it('messages have read/create booleans', () => {
    for (const id of ALL_CONNECTOR_IDS) {
      const m = getEntityCapabilities(id).messages;
      expect(typeof m.read).toBe('boolean');
      expect(typeof m.create).toBe('boolean');
    }
  });

  it('customers have read/create/update booleans', () => {
    for (const id of ALL_CONNECTOR_IDS) {
      const c = getEntityCapabilities(id).customers;
      expect(typeof c.read).toBe('boolean');
      expect(typeof c.create).toBe('boolean');
      expect(typeof c.update).toBe('boolean');
    }
  });

  it('organizations, kbArticles, rules, conversations have read boolean', () => {
    for (const id of ALL_CONNECTOR_IDS) {
      const caps = getEntityCapabilities(id);
      expect(typeof caps.organizations.read).toBe('boolean');
      expect(typeof caps.kbArticles.read).toBe('boolean');
      expect(typeof caps.rules.read).toBe('boolean');
      expect(typeof caps.conversations.read).toBe('boolean');
    }
  });

  it('all connectors support ticket read', () => {
    for (const id of ALL_CONNECTOR_IDS) {
      expect(getEntityCapabilities(id).tickets.read).toBe(true);
    }
  });

  it('all connectors support message read', () => {
    for (const id of ALL_CONNECTOR_IDS) {
      expect(getEntityCapabilities(id).messages.read).toBe(true);
    }
  });

  it('all connectors support customer read', () => {
    for (const id of ALL_CONNECTOR_IDS) {
      expect(getEntityCapabilities(id).customers.read).toBe(true);
    }
  });
});

describe('specific connector entity capabilities', () => {
  it('zendesk has full CRUD for tickets, read for orgs/kb/rules', () => {
    const caps = getEntityCapabilities('zendesk');
    expect(caps.tickets).toEqual({ read: true, create: true, update: true, delete: true });
    expect(caps.messages).toEqual({ read: true, create: true });
    expect(caps.customers).toEqual({ read: true, create: true, update: true });
    expect(caps.organizations.read).toBe(true);
    expect(caps.kbArticles.read).toBe(true);
    expect(caps.rules.read).toBe(true);
  });

  it('freshdesk has full CRUD for tickets, read+create for messages, read for rules', () => {
    const caps = getEntityCapabilities('freshdesk');
    expect(caps.tickets).toEqual({ read: true, create: true, update: true, delete: true });
    expect(caps.messages).toEqual({ read: true, create: true });
    expect(caps.rules.read).toBe(true);
  });

  it('intercom has read+create for tickets (no update/delete), read+create for messages, conversations read', () => {
    const caps = getEntityCapabilities('intercom');
    expect(caps.tickets).toEqual({ read: true, create: true, update: false, delete: false });
    expect(caps.messages).toEqual({ read: true, create: true });
    expect(caps.conversations.read).toBe(true);
  });

  it('hubspot has full CRUD for tickets, read+create for messages, conversations read', () => {
    const caps = getEntityCapabilities('hubspot');
    expect(caps.tickets).toEqual({ read: true, create: true, update: true, delete: true });
    expect(caps.messages).toEqual({ read: true, create: true });
    expect(caps.conversations.read).toBe(true);
  });
});
