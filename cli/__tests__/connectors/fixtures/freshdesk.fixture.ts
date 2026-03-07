/**
 * Mock Freshdesk API responses for parity tests.
 * Shapes match FDTicket, FDConversation, FDContact, etc. in cli/connectors/freshdesk.ts
 */

export const freshdeskTickets = [
  {
    id: 1,
    subject: 'Email not working',
    status: 2, // Open
    priority: 3, // High
    responder_id: 10,
    requester_id: 20,
    tags: ['email', 'critical'],
    created_at: '2026-01-10T08:00:00Z',
    updated_at: '2026-01-11T12:00:00Z',
    custom_fields: { cf_product: 'enterprise' },
    type: 'Incident',
    source: 1,
  },
  {
    id: 2,
    subject: 'How to reset password',
    status: 3, // Pending
    priority: 1, // Low
    responder_id: null,
    requester_id: 21,
    tags: [],
    created_at: '2026-01-20T09:00:00Z',
    updated_at: '2026-01-21T10:00:00Z',
    custom_fields: {},
    type: 'Question',
    source: 2,
  },
  {
    id: 3,
    subject: null, // Test null subject fallback
    status: 5, // Closed
    priority: 4, // Urgent
    responder_id: 10,
    requester_id: 22,
    tags: ['billing'],
    created_at: '2026-02-01T07:00:00Z',
    updated_at: '2026-02-05T18:00:00Z',
    custom_fields: {},
    type: null,
    source: 1,
  },
];

export const freshdeskConversations = [
  {
    id: 100,
    body: '<p>My email stopped working yesterday.</p>',
    body_text: 'My email stopped working yesterday.',
    user_id: 20,
    private: false,
    incoming: true,
    created_at: '2026-01-10T08:00:00Z',
    updated_at: '2026-01-10T08:00:00Z',
  },
  {
    id: 101,
    body: '<p>We are looking into it.</p>',
    body_text: 'We are looking into it.',
    user_id: 10,
    private: false,
    incoming: false,
    created_at: '2026-01-10T09:00:00Z',
    updated_at: '2026-01-10T09:00:00Z',
  },
  {
    id: 102,
    body: '<p>Internal: check server logs.</p>',
    body_text: 'Internal: check server logs.',
    user_id: 10,
    private: true,
    incoming: false,
    created_at: '2026-01-10T09:30:00Z',
    updated_at: '2026-01-10T09:30:00Z',
  },
];

export const freshdeskContacts = [
  { id: 20, name: 'John Doe', email: 'john@example.com', phone: '+15559876543', mobile: null, company_id: 50 },
  { id: 21, name: 'Sarah Smith', email: 'sarah@example.com', phone: null, mobile: '+15551112222', company_id: null },
  { id: 22, name: null, email: 'anon@example.com', phone: null, mobile: null, company_id: null },
];

export const freshdeskCompanies = [
  { id: 50, name: 'Widget Inc', domains: ['widget.com'] },
];

export const freshdeskSLAPolicies = [
  { id: 70, name: 'Default SLA', description: 'Standard response times', is_default: true, applicable_to: {}, sla_target: {} },
];
