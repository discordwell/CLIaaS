/**
 * Mock Zendesk API responses for parity tests.
 * Shapes match the ZendeskTicket, ZendeskUser, etc. interfaces in cli/connectors/zendesk.ts
 */

export const zendeskTickets = [
  {
    id: 101,
    subject: 'Cannot login to dashboard',
    status: 'open',
    priority: 'high',
    assignee_id: 201,
    group_id: 301,
    brand_id: null,
    ticket_form_id: null,
    requester_id: 401,
    tags: ['login', 'urgent'],
    created_at: '2026-01-15T10:30:00Z',
    updated_at: '2026-01-16T08:00:00Z',
    custom_fields: [{ id: 1001, value: 'enterprise' }],
  },
  {
    id: 102,
    subject: 'Feature request: dark mode',
    status: 'pending',
    priority: 'low',
    assignee_id: null,
    group_id: null,
    brand_id: 501,
    ticket_form_id: 601,
    requester_id: 402,
    tags: ['feature-request'],
    created_at: '2026-02-01T14:00:00Z',
    updated_at: '2026-02-02T09:30:00Z',
    custom_fields: [],
  },
  {
    id: 103,
    subject: 'Billing issue — overcharged',
    status: 'solved',
    priority: null,
    assignee_id: 202,
    group_id: 302,
    brand_id: null,
    ticket_form_id: null,
    requester_id: 403,
    tags: [],
    created_at: '2026-02-10T07:15:00Z',
    updated_at: '2026-02-12T16:45:00Z',
    custom_fields: [],
  },
];

export const zendeskComments = [
  {
    id: 1001,
    author_id: 401,
    body: 'I cannot log in since this morning.',
    html_body: '<p>I cannot log in since this morning.</p>',
    public: true,
    created_at: '2026-01-15T10:30:00Z',
    attachments: [],
  },
  {
    id: 1002,
    author_id: 201,
    body: 'Have you tried clearing your cache?',
    html_body: '<p>Have you tried clearing your cache?</p>',
    public: true,
    created_at: '2026-01-15T11:00:00Z',
    attachments: [
      { id: 5001, file_name: 'steps.pdf', content_type: 'application/pdf', size: 12345, content_url: 'https://cdn.zendesk.com/5001' },
    ],
  },
  {
    id: 1003,
    author_id: 201,
    body: 'Internal note: escalate if not resolved by EOD.',
    html_body: '<p>Internal note: escalate if not resolved by EOD.</p>',
    public: false,
    created_at: '2026-01-15T11:30:00Z',
    attachments: [],
  },
];

export const zendeskUsers = [
  { id: 401, name: 'Jane Customer', email: 'jane@example.com', phone: '+15551234567', organization_id: 701 },
  { id: 402, name: 'Bob Requester', email: 'bob@example.com', phone: null, organization_id: null },
  { id: 201, name: 'Alice Agent', email: 'alice@company.com', phone: null, organization_id: null },
];

export const zendeskOrganizations = [
  { id: 701, name: 'Acme Corp', domain_names: ['acme.com', 'acme.io'] },
];

export const zendeskMacros = [
  { id: 801, title: 'Close and thank', active: true, restriction: null, actions: [{ field: 'status', value: 'closed' }] },
];

export const zendeskArticles = [
  { id: 901, title: 'Getting Started Guide', body: '<h1>Welcome</h1><p>Here is how to get started.</p>', section_id: 1001 },
];
