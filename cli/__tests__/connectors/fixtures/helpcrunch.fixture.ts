/**
 * Mock HelpCrunch API responses for parity tests.
 * Shapes match HCChat, HCMessage, HCCustomer, etc. in cli/connectors/helpcrunch.ts
 */

export const helpcrunchChats = [
  {
    id: 9001,
    status: 1, // New
    createdAt: '1706000000', // epoch string
    closedAt: null,
    lastMessageAt: '1706100000',
    lastMessageText: 'Hi, I need help with my subscription.',
    customer: { id: 800, name: 'Chat User', email: 'chatuser@example.com' },
    assignee: { id: 900, name: 'Agent One', email: 'agent1@company.com' },
    agents: [{ id: 900, name: 'Agent One' }],
    department: { id: 10, name: 'Support' },
  },
  {
    id: 9002,
    status: 3, // Pending
    createdAt: '1706200000',
    closedAt: null,
    lastMessageAt: '1706300000',
    lastMessageText: 'When will the new feature be available?',
    customer: { id: 801, name: null, email: 'anon@example.com' },
    assignee: null,
    agents: [],
    department: null,
  },
  {
    id: 9003,
    status: 5, // Closed
    createdAt: '1706400000',
    closedAt: '1706500000',
    lastMessageAt: '1706500000',
    lastMessageText: 'Thank you for your help!',
    customer: { id: 802, name: 'Happy Customer', email: 'happy@example.com' },
    assignee: { id: 901, name: 'Agent Two' },
    agents: [{ id: 901, name: 'Agent Two' }],
    department: { id: 11, name: 'Billing' },
  },
];

export const helpcrunchMessages = [
  {
    id: 10001,
    text: 'Hi, I need help with my subscription.',
    type: 'message',
    from: 'customer' as const,
    createdAt: '1706000000',
    read: true,
  },
  {
    id: 10002,
    text: 'Sure, let me look into your account.',
    type: 'message',
    from: 'agent' as const,
    createdAt: '1706050000',
    agent: { id: 900, name: 'Agent One', email: 'agent1@company.com' },
    read: true,
  },
  {
    id: 10003,
    text: 'Customer seems upset — handle with care.',
    type: 'private',
    from: 'agent' as const,
    createdAt: '1706060000',
    agent: { id: 900, name: 'Agent One' },
    read: false,
  },
];

export const helpcrunchCustomers = [
  { id: 800, name: 'Chat User', email: 'chatuser@example.com', phone: '+15551112222', company: 'ChatCo', userId: 'u800', createdFrom: 'widget' },
  { id: 801, name: null, email: 'anon@example.com', phone: null, company: null, userId: null, createdFrom: null },
  { id: 802, name: 'Happy Customer', email: 'happy@example.com', phone: null, company: 'ChatCo', userId: 'u802', createdFrom: 'api' },
];

export const helpcrunchAgents = [
  { id: 900, name: 'Agent One', email: 'agent1@company.com', role: 'admin' },
  { id: 901, name: 'Agent Two', email: 'agent2@company.com', role: 'agent' },
];
