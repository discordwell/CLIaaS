/**
 * Mock Intercom API responses for parity tests.
 * Shapes match ICConversation, ICConversationPart, ICContact, etc. in cli/connectors/intercom.ts
 */

export const intercomConversations = [
  {
    id: 'conv-1',
    title: 'Cannot access my account',
    state: 'open',
    priority: 'priority',
    created_at: 1706000000, // epoch seconds
    updated_at: 1706100000,
    waiting_since: null,
    snoozed_until: null,
    source: {
      author: { id: 'user-100', type: 'user', email: 'user100@example.com' },
      body: 'I keep getting locked out of my account.',
      delivered_as: 'customer_initiated',
    },
    assignee: { id: 'admin-1', type: 'admin' },
    tags: { tags: [{ id: 'tag-1', name: 'access-issue' }] },
    contacts: { contacts: [{ id: 'user-100', type: 'user' }] },
    statistics: {},
  },
  {
    id: 'conv-2',
    title: null,
    state: 'closed',
    priority: 'not_priority',
    created_at: 1706200000,
    updated_at: 1706300000,
    waiting_since: null,
    snoozed_until: null,
    source: {
      author: { id: 'user-101', type: 'user' },
      body: 'How do I update my billing info?',
      delivered_as: 'customer_initiated',
    },
    assignee: null,
    tags: { tags: [] },
    contacts: { contacts: [{ id: 'user-101', type: 'user' }] },
    statistics: {},
  },
  {
    id: 'conv-3',
    title: 'Integration question',
    state: 'snoozed',
    priority: 'not_priority',
    created_at: 1706400000,
    updated_at: 1706500000,
    waiting_since: 1706450000,
    snoozed_until: 1706600000,
    source: {
      author: { id: 'user-102', type: 'user' },
      body: 'Does your API support webhooks?',
      delivered_as: 'customer_initiated',
    },
    assignee: { id: 'admin-2', type: 'admin' },
    tags: { tags: [{ id: 'tag-2', name: 'api' }, { id: 'tag-3', name: 'integration' }] },
    contacts: { contacts: [{ id: 'user-102', type: 'user' }] },
    statistics: {},
  },
];

export const intercomConversationParts = [
  {
    id: 'part-1',
    part_type: 'comment',
    body: 'Let me check your account status.',
    author: { id: 'admin-1', type: 'admin' },
    created_at: 1706050000,
  },
  {
    id: 'part-2',
    part_type: 'note',
    body: 'Customer has been locked out 3 times this week.',
    author: { id: 'admin-1', type: 'admin' },
    created_at: 1706060000,
  },
];

export const intercomContacts = [
  { id: 'user-100', type: 'contact', role: 'user', email: 'user100@example.com', name: 'Alice User', phone: '+15559991111', created_at: 1700000000, companies: { data: [{ id: 'comp-1' }] } },
  { id: 'user-101', type: 'contact', role: 'user', email: 'user101@example.com', name: 'Bob User', phone: null, created_at: 1701000000, companies: null },
  { id: 'user-102', type: 'contact', role: 'lead', email: null, name: null, phone: null, created_at: 1702000000, companies: null },
];

export const intercomCompanies = [
  { id: 'comp-1', name: 'TechCo', company_id: 'techco', website: 'https://techco.com', plan: { name: 'pro' }, created_at: 1690000000 },
];

export const intercomAdmins = [
  { id: 'admin-1', name: 'Support Agent', email: 'support@company.com', type: 'admin' },
  { id: 'admin-2', name: 'Tech Lead', email: 'tech@company.com', type: 'admin' },
];

export const intercomArticles = [
  { id: 'art-1', title: 'Getting Started', body: '<p>Welcome to our product.</p>', state: 'published', parent_id: 10, parent_type: 'collection', created_at: 1700000000, updated_at: 1705000000 },
];
