/**
 * Mock Zoho Desk API responses for parity tests.
 * Shapes match ZDTicket, ZDThread, ZDContact, etc. in cli/connectors/zoho-desk.ts
 */

export const zohoDeskTickets = [
  {
    id: 'zd-5001',
    ticketNumber: '5001',
    subject: 'App crashes on startup',
    status: 'Open',
    priority: 'High',
    assigneeId: 'agent-1',
    contactId: 'contact-1',
    departmentId: 'dept-1',
    channel: 'Email',
    category: 'Bug',
    tags: ['crash', 'mobile'],
    createdTime: '2026-01-08T10:00:00Z',
    modifiedTime: '2026-01-09T11:00:00Z',
    customFields: { cf_platform: 'iOS' },
  },
  {
    id: 'zd-5002',
    ticketNumber: '5002',
    subject: 'Cannot export data',
    status: 'On Hold',
    priority: null,
    assigneeId: null,
    contactId: 'contact-2',
    departmentId: null,
    channel: 'Portal',
    category: null,
    tags: null,
    createdTime: '2026-01-12T14:00:00Z',
    modifiedTime: '2026-01-13T09:00:00Z',
    customFields: {},
  },
  {
    id: 'zd-5003',
    ticketNumber: '5003',
    subject: 'Subscription renewal',
    status: 'Closed',
    priority: 'Low',
    assigneeId: 'agent-2',
    contactId: 'contact-3',
    departmentId: 'dept-2',
    channel: 'Phone',
    category: 'Billing',
    tags: ['renewal'],
    createdTime: '2026-01-20T07:00:00Z',
    modifiedTime: '2026-01-22T17:00:00Z',
    customFields: {},
  },
];

export const zohoDeskThreads = [
  {
    id: 'thread-1',
    direction: 'in',
    type: 'reply',
    content: 'The app crashes every time I open it.',
    contentType: 'text/plain',
    createdTime: '2026-01-08T10:00:00Z',
    author: { id: 'contact-1', name: 'Customer One', type: 'END_USER' },
    isPrivate: false,
  },
  {
    id: 'thread-2',
    direction: 'out',
    type: 'reply',
    content: 'We are investigating the crash.',
    contentType: 'text/plain',
    createdTime: '2026-01-08T11:00:00Z',
    author: { id: 'agent-1', name: 'Agent Smith', type: 'AGENT' },
    isPrivate: false,
  },
];

export const zohoDeskComments = [
  {
    id: 'comment-1',
    content: 'Need to check crash logs from Sentry.',
    commentedTime: '2026-01-08T12:00:00Z',
    commenter: { id: 'agent-1', name: 'Agent Smith' },
    isPublic: false,
  },
];

export const zohoDeskContacts = [
  { id: 'contact-1', firstName: 'Customer', lastName: 'One', email: 'cust1@example.com', phone: '+15551234567', mobile: null, accountId: 'acct-1' },
  { id: 'contact-2', firstName: null, lastName: null, email: 'cust2@example.com', phone: null, mobile: '+15559876543', accountId: null },
  { id: 'contact-3', firstName: 'Customer', lastName: 'Three', email: null, phone: null, mobile: null, accountId: 'acct-1' },
];

export const zohoDeskAccounts = [
  { id: 'acct-1', accountName: 'Global Corp', website: 'https://globalcorp.com', industry: 'Finance' },
];

export const zohoDeskArticles = [
  { id: 'art-1', title: 'Troubleshooting Guide', answer: '<p>Follow these steps...</p>', categoryId: 'cat-1', sectionId: 'sec-1', status: 'Published', createdTime: '2025-12-01T10:00:00Z' },
];

export const zohoDeskAgents = [
  { id: 'agent-1', name: 'Agent Smith', emailId: 'smith@company.com', roleId: 'role-1' },
  { id: 'agent-2', name: 'Agent Jones', emailId: 'jones@company.com', roleId: 'role-2' },
];
