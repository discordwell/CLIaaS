// Canonical schema types for CLIaaS
// All connectors normalize into these types

export type TicketStatus = 'open' | 'pending' | 'on_hold' | 'solved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type MessageType = 'reply' | 'note' | 'system';

export interface Ticket {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee?: string;
  groupId?: string;
  brandId?: string;
  ticketFormId?: string;
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
  attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  externalId: string;
  messageId: string;
  filename: string;
  size: number;
  contentType?: string;
  contentUrl?: string;
}

export interface Customer {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  name: string;
  email: string;
  phone?: string;
  orgId?: string;
}

export interface Organization {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  name: string;
  domains: string[];
}

export interface KBArticle {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  title: string;
  body: string;
  categoryPath: string[];
}

export interface Group {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  name: string;
}

export interface CustomField {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  objectType: string;
  name: string;
  fieldType: string;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
}

export interface View {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  name: string;
  query: unknown;
  active?: boolean;
}

export interface SLAPolicy {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  name: string;
  enabled: boolean;
  targets?: unknown;
  schedules?: unknown;
}

export interface AuditEvent {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  ticketId: string;
  authorId?: string;
  eventType: string;
  createdAt: string;
  raw?: unknown;
}

export interface CSATRating {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  ticketId: string;
  rating: number;
  comment?: string;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  ticketId: string;
  agentId?: string;
  minutes: number;
  note?: string;
  createdAt: string;
}

export interface TicketForm {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  name: string;
  active?: boolean;
  position?: number;
  fieldIds?: number[];
  raw?: unknown;
}

export interface Brand {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  name: string;
  raw?: unknown;
}

export type RuleType = 'macro' | 'trigger' | 'automation' | 'sla';

export interface Rule {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  type: RuleType;
  title: string;
  conditions: unknown;
  actions: unknown;
  active: boolean;
}

export interface ExportManifest {
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
  exportedAt: string;
  counts: {
    tickets: number;
    messages: number;
    attachments?: number;
    customers: number;
    organizations: number;
    kbArticles: number;
    rules: number;
    groups?: number;
    customFields?: number;
    views?: number;
    slaPolicies?: number;
    ticketForms?: number;
    brands?: number;
    auditEvents?: number;
    csatRatings?: number;
    timeEntries?: number;
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
