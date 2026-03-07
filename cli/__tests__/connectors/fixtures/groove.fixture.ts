/**
 * Mock Groove API responses for parity tests.
 * Shapes match GVTicket, GVMessage, GVCustomer, etc. in cli/connectors/groove.ts
 */

export const grooveTickets = [
  {
    number: 7001,
    title: 'Sync error on import',
    state: 'opened',
    tags: ['import', 'sync'],
    starred: false,
    message_count: 2,
    created_at: '2026-01-02T10:00:00Z',
    updated_at: '2026-01-03T15:00:00Z',
    assigned_group: 'support',
    closed_by: null,
    priority: 'high',
    links: {
      assignee: { href: 'https://api.groovehq.com/v1/agents/agent@company.com' },
      customer: { href: 'https://api.groovehq.com/v1/customers/cust@example.com' },
      messages: { href: 'https://api.groovehq.com/v1/tickets/7001/messages' },
    },
  },
  {
    number: 7002,
    title: 'Feature: add CSV export',
    state: 'pending',
    tags: ['feature-request'],
    starred: true,
    message_count: 1,
    created_at: '2026-01-05T08:00:00Z',
    updated_at: '2026-01-06T12:00:00Z',
    assigned_group: null,
    closed_by: null,
    priority: null,
    links: {
      customer: { href: 'https://api.groovehq.com/v1/customers/user@example.com' },
      messages: { href: 'https://api.groovehq.com/v1/tickets/7002/messages' },
    },
  },
  {
    number: 7003,
    title: 'Resolved: API rate limit',
    state: 'closed',
    tags: [],
    starred: false,
    message_count: 3,
    created_at: '2026-01-10T07:00:00Z',
    updated_at: '2026-01-12T18:00:00Z',
    assigned_group: 'engineering',
    closed_by: 'agent2@company.com',
    priority: 'urgent',
    links: {
      assignee: { href: 'https://api.groovehq.com/v1/agents/agent2@company.com' },
      customer: { href: 'https://api.groovehq.com/v1/customers/dev@example.com' },
      messages: { href: 'https://api.groovehq.com/v1/tickets/7003/messages' },
    },
  },
];

export const grooveMessages = [
  {
    href: 'https://api.groovehq.com/v1/messages/msg-1001',
    created_at: '2026-01-02T10:00:00Z',
    updated_at: '2026-01-02T10:00:00Z',
    body: '<p>I get an error when importing my CSV file.</p>',
    plain_text_body: 'I get an error when importing my CSV file.',
    note: false,
    links: {
      author: { href: 'https://api.groovehq.com/v1/customers/cust@example.com' },
      ticket: { href: 'https://api.groovehq.com/v1/tickets/7001' },
    },
  },
  {
    href: 'https://api.groovehq.com/v1/messages/msg-1002',
    created_at: '2026-01-02T11:00:00Z',
    updated_at: '2026-01-02T11:00:00Z',
    body: '<p>Internal: check the parser for CSV encoding issues.</p>',
    plain_text_body: 'Internal: check the parser for CSV encoding issues.',
    note: true,
    links: {
      author: { href: 'https://api.groovehq.com/v1/agents/agent@company.com' },
      ticket: { href: 'https://api.groovehq.com/v1/tickets/7001' },
    },
  },
];

export const grooveCustomers = [
  { email: 'cust@example.com', name: 'Customer One', about: null, company_name: 'CustCo', phone_number: '+15551234567', location: 'US' },
  { email: 'user@example.com', name: null, about: null, company_name: null, phone_number: null, location: null },
  { email: 'dev@example.com', name: 'Dev User', about: 'Developer', company_name: 'DevShop', phone_number: null, location: 'UK' },
];

export const grooveAgents = [
  { email: 'agent@company.com', first_name: 'Support', last_name: 'Agent' },
  { email: 'agent2@company.com', first_name: 'Senior', last_name: 'Engineer' },
];

export const grooveKBs = [
  { id: 'kb-1', title: 'Help Center', subdomain: 'help' },
];

export const grooveKBArticles = [
  { id: 'kbart-1', title: 'Import Guide', body: '<p>How to import data...</p>', state: 'published', category_id: 'cat-1', tags: ['import'], created_at: '2025-10-01T00:00:00Z', updated_at: '2025-12-01T00:00:00Z' },
];
