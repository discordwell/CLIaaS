/**
 * Shared test fixtures for CLI command tests.
 */
import type { Ticket, Message, KBArticle } from '../../schema/types.js';

export function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'tk-001',
    externalId: '1001',
    source: 'zendesk',
    subject: 'Login not working',
    status: 'open',
    priority: 'normal',
    assignee: 'Alice',
    requester: 'bob@example.com',
    tags: ['login', 'auth'],
    createdAt: '2026-03-01T10:00:00Z',
    updatedAt: '2026-03-01T12:00:00Z',
    ...overrides,
  };
}

export function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-001',
    ticketId: 'tk-001',
    author: 'bob@example.com',
    body: 'I cannot log in to the system.',
    type: 'reply',
    createdAt: '2026-03-01T10:05:00Z',
    ...overrides,
  };
}

export function makeKBArticle(overrides: Partial<KBArticle> = {}): KBArticle {
  return {
    id: 'kb-001',
    externalId: 'ext-kb-001',
    source: 'zendesk',
    title: 'How to reset your password',
    body: 'Go to settings and click "Reset password"...',
    categoryPath: ['Account', 'Security'],
    ...overrides,
  };
}

/** Generate a list of tickets with varied statuses, priorities, assignees. */
export function makeSampleTickets(): Ticket[] {
  return [
    makeTicket({ id: 'tk-001', externalId: '1001', subject: 'Login not working', status: 'open', priority: 'urgent', assignee: 'Alice', tags: ['login', 'auth'] }),
    makeTicket({ id: 'tk-002', externalId: '1002', subject: 'Billing issue', status: 'open', priority: 'high', assignee: 'Bob', tags: ['billing'] }),
    makeTicket({ id: 'tk-003', externalId: '1003', subject: 'Feature request: dark mode', status: 'pending', priority: 'low', assignee: undefined, tags: ['feature-request'] }),
    makeTicket({ id: 'tk-004', externalId: '1004', subject: 'Cannot export data', status: 'open', priority: 'normal', assignee: 'Alice', tags: ['export', 'data'] }),
    makeTicket({ id: 'tk-005', externalId: '1005', subject: 'Mobile app crash on startup', status: 'solved', priority: 'high', assignee: 'Charlie', tags: ['mobile', 'crash'] }),
  ];
}

export function makeSampleMessages(): Message[] {
  return [
    makeMessage({ id: 'msg-001', ticketId: 'tk-001', author: 'bob@example.com', body: 'I cannot log in to the system. It says invalid credentials.', type: 'reply', createdAt: '2026-03-01T10:05:00Z' }),
    makeMessage({ id: 'msg-002', ticketId: 'tk-001', author: 'Alice', body: 'Can you try resetting your password?', type: 'reply', createdAt: '2026-03-01T10:30:00Z' }),
    makeMessage({ id: 'msg-003', ticketId: 'tk-002', author: 'customer2@test.com', body: 'I was charged twice for my subscription.', type: 'reply', createdAt: '2026-03-01T11:00:00Z' }),
    makeMessage({ id: 'msg-004', ticketId: 'tk-004', author: 'customer4@test.com', body: 'Export button does nothing when clicked.', type: 'reply', createdAt: '2026-03-01T09:00:00Z' }),
  ];
}
