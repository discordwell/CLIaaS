export type TicketStatus = 'open' | 'pending' | 'on_hold' | 'solved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type MessageType = 'reply' | 'note' | 'system';

export interface Ticket {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove';
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
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove';
  name: string;
  email: string;
  phone?: string;
  orgId?: string;
}

export interface Organization {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove';
  name: string;
  domains: string[];
}

export interface KBArticle {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove';
  title: string;
  body: string;
  categoryPath: string[];
}

export interface Group {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove';
  name: string;
}

export interface CustomField {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove';
  objectType: string;
  name: string;
  fieldType: string;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
}

export interface View {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove';
  name: string;
  query: unknown;
  active?: boolean;
}

export interface SLAPolicy {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove';
  name: string;
  enabled: boolean;
  targets?: unknown;
  schedules?: unknown;
}

export interface TicketForm {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove';
  name: string;
  active?: boolean;
  position?: number;
  fieldIds?: number[];
  raw?: unknown;
}

export interface Brand {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove';
  name: string;
  raw?: unknown;
}

export type RuleType = 'macro' | 'trigger' | 'automation' | 'sla';

export interface Rule {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove';
  type: RuleType;
  title: string;
  conditions: unknown;
  actions: unknown;
  active: boolean;
}
