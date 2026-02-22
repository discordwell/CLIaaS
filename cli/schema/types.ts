// Canonical schema types for CLIaaS
// All connectors normalize into these types

export type TicketStatus = 'open' | 'pending' | 'on_hold' | 'solved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type MessageType = 'reply' | 'note' | 'system';

export interface Ticket {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic';
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee?: string;
  requester: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  customFields?: Record<string, unknown>;
}

export interface Message {
  id: string;
  ticketId: string;
  author: string;
  body: string;
  bodyHtml?: string;
  type: MessageType;
  createdAt: string;
}

export interface Customer {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic';
  name: string;
  email: string;
  phone?: string;
  orgId?: string;
}

export interface Organization {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic';
  name: string;
  domains: string[];
}

export interface KBArticle {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic';
  title: string;
  body: string;
  categoryPath: string[];
}

export type RuleType = 'macro' | 'trigger' | 'automation' | 'sla';

export interface Rule {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic';
  type: RuleType;
  title: string;
  conditions: unknown;
  actions: unknown;
  active: boolean;
}

export interface ExportManifest {
  source: 'zendesk' | 'kayako' | 'kayako-classic';
  exportedAt: string;
  counts: {
    tickets: number;
    messages: number;
    customers: number;
    organizations: number;
    kbArticles: number;
    rules: number;
  };
  cursorState?: Record<string, string>;
}

export interface TriageResult {
  ticketId: string;
  suggestedPriority: TicketPriority;
  suggestedAssignee?: string;
  suggestedCategory: string;
  reasoning: string;
}

export interface KBSuggestion {
  articleId: string;
  title: string;
  relevanceScore: number;
  reasoning: string;
}
