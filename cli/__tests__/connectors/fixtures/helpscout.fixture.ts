/**
 * Mock Help Scout API responses for parity tests.
 * Shapes match HSConversation, HSThread, HSCustomer, etc. in cli/connectors/helpscout.ts
 */

export const helpscoutConversations = [
  {
    id: 3001,
    number: 3001,
    subject: 'Account upgrade request',
    status: 'active',
    state: 'published',
    priority: null,
    mailboxId: 100,
    assignee: { id: 200, email: 'agent@company.com', first: 'Support', last: 'Agent' },
    primaryCustomer: { id: 300, email: 'cust@example.com' },
    tags: [{ id: 1, tag: 'upgrade' }, { id: 2, tag: 'billing' }],
    createdAt: '2026-01-05T10:00:00Z',
    closedAt: null,
    userUpdatedAt: '2026-01-06T12:00:00Z',
    customFields: [{ id: 10, name: 'product', value: 'pro' }],
  },
  {
    id: 3002,
    number: 3002,
    subject: 'Slow performance',
    status: 'pending',
    state: 'published',
    priority: null,
    mailboxId: 100,
    assignee: undefined,
    primaryCustomer: { id: 301 },
    tags: [],
    createdAt: '2026-01-10T14:00:00Z',
    closedAt: null,
    userUpdatedAt: '2026-01-11T09:00:00Z',
    customFields: [],
  },
  {
    id: 3003,
    number: 3003,
    subject: 'Resolved: export bug',
    status: 'closed',
    state: 'published',
    priority: null,
    mailboxId: 101,
    assignee: { id: 201, email: 'dev@company.com', first: 'Dev', last: 'Team' },
    primaryCustomer: { id: 302, email: 'dev@example.com' },
    tags: [{ id: 3, tag: 'bug' }],
    createdAt: '2026-01-15T08:00:00Z',
    closedAt: '2026-01-18T16:00:00Z',
    userUpdatedAt: '2026-01-18T16:00:00Z',
    customFields: [],
  },
];

export const helpscoutThreads = [
  {
    id: 4001,
    type: 'customer',
    body: 'I would like to upgrade my plan to enterprise.',
    status: 'active',
    createdAt: '2026-01-05T10:00:00Z',
    createdBy: { id: 300, type: 'customer', email: 'cust@example.com' },
  },
  {
    id: 4002,
    type: 'reply',
    body: 'Sure, I can help you with that.',
    status: 'active',
    createdAt: '2026-01-05T10:30:00Z',
    createdBy: { id: 200, type: 'user' },
  },
  {
    id: 4003,
    type: 'note',
    body: 'Customer has been on Pro plan for 2 years.',
    status: 'active',
    createdAt: '2026-01-05T10:35:00Z',
    createdBy: { id: 200, type: 'user' },
  },
];

export const helpscoutCustomers = [
  {
    id: 300,
    firstName: 'Alice',
    lastName: 'Customer',
    emails: [{ id: 1, value: 'cust@example.com' }],
    phones: [{ id: 1, value: '+15551112222' }],
    organization: 'AliceCo',
    createdAt: '2025-06-01T00:00:00Z',
  },
  {
    id: 301,
    firstName: 'Bob',
    lastName: 'NoOrg',
    emails: [{ id: 2, value: 'bob@example.com' }],
    phones: [],
    organization: null,
    createdAt: '2025-07-01T00:00:00Z',
  },
  {
    id: 302,
    firstName: null,
    lastName: null,
    emails: [{ id: 3, value: 'dev@example.com' }],
    phones: [],
    organization: 'DevShop',
    createdAt: '2025-08-01T00:00:00Z',
  },
];

export const helpscoutUsers = [
  { id: 200, firstName: 'Support', lastName: 'Agent', email: 'agent@company.com' },
  { id: 201, firstName: 'Dev', lastName: 'Team', email: 'dev@company.com' },
];

export const helpscoutCollections = [
  { id: 'coll-1', name: 'General KB', siteId: 'site-1', slug: 'general' },
];

export const helpscoutArticles = [
  {
    id: 'art-1',
    collectionId: 'coll-1',
    name: 'How to upgrade your plan',
    text: '<p>Follow these steps to upgrade...</p>',
    status: 'published',
    categories: [{ id: 'cat-1', name: 'Billing' }],
    createdAt: '2025-11-01T10:00:00Z',
  },
];
