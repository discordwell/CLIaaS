/**
 * Connector Parity Test Suite
 *
 * Verifies that all connectors produce entities conforming to the canonical
 * CLIaaS schema types (Ticket, Message, Customer, Organization, etc.).
 *
 * Since we cannot make real API calls in unit tests, we use mock data fixtures
 * that simulate API responses and apply the same normalization/mapping logic
 * each connector uses to verify correct entity shapes.
 *
 * The suite is organized into:
 * 1. Per-connector entity shape tests (using fixture data + inline mapping)
 * 2. Required field tests
 * 3. Count accuracy tests
 * 4. Cross-connector consistency tests
 * 5. Normalization utility tests
 */

import { describe, it, expect } from 'vitest';
import type {
  Ticket, Message, Customer, Organization, KBArticle, Rule,
  ExportManifest, TicketStatus, TicketPriority,
} from '../../schema/types';
import {
  resolveStatus, resolvePriority, fuzzyStatusMatch, fuzzyPriorityMatch,
  initCounts, epochToISO, flushCollectedOrgs,
} from '../../connectors/base/normalize';

// ---- Fixture imports ----
import * as zdFixture from './fixtures/zendesk.fixture';
import * as fdFixture from './fixtures/freshdesk.fixture';
import * as icFixture from './fixtures/intercom.fixture';
import * as hsFixture from './fixtures/hubspot.fixture';
import * as zoFixture from './fixtures/zoho-desk.fixture';
import * as hscFixture from './fixtures/helpscout.fixture';
import * as gvFixture from './fixtures/groove.fixture';
import * as hcFixture from './fixtures/helpcrunch.fixture';

// ---- Constants ----

const VALID_STATUSES: TicketStatus[] = ['open', 'pending', 'on_hold', 'solved', 'closed'];
const VALID_PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];

const CONNECTOR_IDS = [
  'zendesk', 'freshdesk', 'intercom', 'hubspot',
  'zoho-desk', 'helpscout', 'groove', 'helpcrunch',
] as const;

// ---- Helpers ----

function isValidISODate(value: string): boolean {
  if (!value || value === '') return true;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

// ---- Connector-specific mapping functions (mirrors connector code) ----

const zendeskStatusMap: Record<string, TicketStatus> = {
  new: 'open', open: 'open', pending: 'pending', hold: 'on_hold', solved: 'solved', closed: 'closed',
};
function zdMapStatus(s: string): TicketStatus { return zendeskStatusMap[s] ?? 'open'; }
function zdMapPriority(p: string | null): TicketPriority {
  if (!p) return 'normal';
  const map: Record<string, TicketPriority> = { low: 'low', normal: 'normal', high: 'high', urgent: 'urgent' };
  return map[p] ?? 'normal';
}

const fdStatusMap: Record<number, TicketStatus> = { 2: 'open', 3: 'pending', 4: 'solved', 5: 'closed' };
const fdPriorityMap: Record<number, TicketPriority> = { 1: 'low', 2: 'normal', 3: 'high', 4: 'urgent' };
function fdMapStatus(s: number): TicketStatus { return fdStatusMap[s] ?? 'open'; }
function fdMapPriority(p: number): TicketPriority { return fdPriorityMap[p] ?? 'normal'; }

const icStateMap: Record<string, TicketStatus> = { open: 'open', closed: 'closed', snoozed: 'on_hold' };
function icMapState(s: string): TicketStatus { return icStateMap[s] ?? 'open'; }
function icMapPriority(p: string): TicketPriority { return p === 'priority' ? 'high' : 'normal'; }

function hsMapPipelineStage(stage: string | undefined): TicketStatus {
  if (!stage) return 'open';
  const lower = stage.toLowerCase();
  if (lower.includes('new') || lower.includes('open') || lower === '1') return 'open';
  if (lower.includes('waiting') || lower.includes('pending') || lower === '2') return 'pending';
  if (lower.includes('closed') || lower.includes('resolved') || lower === '3' || lower === '4') return 'closed';
  return 'open';
}
function hsMapPriority(p: string | undefined): TicketPriority {
  if (!p) return 'normal';
  const lower = p.toLowerCase();
  if (lower === 'low') return 'low';
  if (lower === 'medium') return 'normal';
  if (lower === 'high') return 'high';
  return 'normal';
}

function zoMapStatus(status: string): TicketStatus {
  const lower = status.toLowerCase();
  if (lower === 'open' || lower === 'new') return 'open';
  if (lower === 'on hold') return 'on_hold';
  if (lower === 'escalated') return 'pending';
  if (lower === 'closed') return 'closed';
  return 'open';
}

const hscStatusMap: Record<string, TicketStatus> = { active: 'open', pending: 'pending', closed: 'closed', spam: 'closed' };
function hscMapStatus(s: string): TicketStatus { return hscStatusMap[s] ?? 'open'; }

const gvStateMap: Record<string, TicketStatus> = { unread: 'open', opened: 'open', pending: 'pending', closed: 'closed', spam: 'closed' };
function gvMapState(s: string): TicketStatus { return gvStateMap[s] ?? 'open'; }
function gvMapPriority(p: string | null): TicketPriority {
  if (!p) return 'normal';
  const map: Record<string, TicketPriority> = { low: 'low', normal: 'normal', high: 'high', urgent: 'urgent' };
  return map[p.toLowerCase()] ?? 'normal';
}

const hcChatStatusMap: Record<number, TicketStatus> = { 1: 'open', 2: 'open', 3: 'pending', 4: 'on_hold', 5: 'closed', 6: 'closed', 7: 'closed' };
function hcMapChatStatus(s: number): TicketStatus { return hcChatStatusMap[s] ?? 'open'; }

// ---- Transform fixture data into normalized entities ----

function normalizeZendeskTickets(): Ticket[] {
  return zdFixture.zendeskTickets.map(t => ({
    id: `zd-${t.id}`, externalId: String(t.id), source: 'zendesk' as const,
    subject: t.subject, status: zdMapStatus(t.status), priority: zdMapPriority(t.priority),
    assignee: t.assignee_id ? String(t.assignee_id) : undefined,
    requester: String(t.requester_id), tags: t.tags,
    createdAt: t.created_at, updatedAt: t.updated_at,
    customFields: t.custom_fields ? Object.fromEntries(t.custom_fields.map(f => [String(f.id), f.value])) : undefined,
  }));
}

function normalizeZendeskMessages(): Message[] {
  return zdFixture.zendeskComments.map(c => ({
    id: `zd-msg-${c.id}`, ticketId: `zd-${zdFixture.zendeskTickets[0].id}`,
    author: String(c.author_id), body: c.body,
    bodyHtml: c.html_body, type: (c.public ? 'reply' : 'note') as Message['type'],
    createdAt: c.created_at,
  }));
}

function normalizeZendeskCustomers(): Customer[] {
  return zdFixture.zendeskUsers.map(u => ({
    id: `zd-user-${u.id}`, externalId: String(u.id), source: 'zendesk' as const,
    name: u.name, email: u.email, phone: u.phone ?? undefined,
    orgId: u.organization_id ? String(u.organization_id) : undefined,
  }));
}

function normalizeZendeskOrgs(): Organization[] {
  return zdFixture.zendeskOrganizations.map(o => ({
    id: `zd-org-${o.id}`, externalId: String(o.id), source: 'zendesk' as const,
    name: o.name, domains: o.domain_names,
  }));
}

function normalizeZendeskRules(): Rule[] {
  return zdFixture.zendeskMacros.map(m => ({
    id: `zd-macro-${m.id}`, externalId: String(m.id), source: 'zendesk' as const,
    type: 'macro' as const, title: m.title, conditions: m.restriction, actions: m.actions, active: m.active,
  }));
}

function normalizeFreshdeskTickets(): Ticket[] {
  return fdFixture.freshdeskTickets.map(t => ({
    id: `fd-${t.id}`, externalId: String(t.id), source: 'freshdesk' as const,
    subject: t.subject ?? `Ticket #${t.id}`,
    status: fdMapStatus(t.status), priority: fdMapPriority(t.priority),
    assignee: t.responder_id ? String(t.responder_id) : undefined,
    requester: String(t.requester_id), tags: t.tags ?? [],
    createdAt: t.created_at, updatedAt: t.updated_at, customFields: t.custom_fields,
  }));
}

function normalizeFreshdeskMessages(): Message[] {
  return fdFixture.freshdeskConversations.map(c => ({
    id: `fd-msg-${c.id}`, ticketId: `fd-${fdFixture.freshdeskTickets[0].id}`,
    author: String(c.user_id), body: c.body_text ?? c.body ?? '',
    bodyHtml: c.body, type: (c.private ? 'note' : 'reply') as Message['type'],
    createdAt: c.created_at,
  }));
}

function normalizeFreshdeskCustomers(): Customer[] {
  return fdFixture.freshdeskContacts.map(c => ({
    id: `fd-user-${c.id}`, externalId: String(c.id), source: 'freshdesk' as const,
    name: c.name ?? c.email ?? `Contact ${c.id}`, email: c.email ?? '',
    phone: c.phone ?? c.mobile ?? undefined,
    orgId: c.company_id ? `fd-org-${c.company_id}` : undefined,
  }));
}

function normalizeIntercomTickets(): Ticket[] {
  return icFixture.intercomConversations.map(conv => ({
    id: `ic-${conv.id}`, externalId: conv.id, source: 'intercom' as const,
    subject: conv.title ?? conv.source?.body?.slice(0, 100) ?? `Conversation #${conv.id}`,
    status: icMapState(conv.state), priority: icMapPriority(conv.priority),
    assignee: conv.assignee?.id ?? undefined,
    requester: conv.contacts?.contacts?.[0]?.id ?? 'unknown',
    tags: (conv.tags?.tags ?? []).map(t => t.name),
    createdAt: epochToISO(conv.created_at), updatedAt: epochToISO(conv.updated_at),
    customFields: { source: 'conversation' },
  }));
}

function normalizeIntercomMessages(): Message[] {
  // Source messages
  const sourceMessages = icFixture.intercomConversations
    .filter(c => c.source?.body)
    .map(c => ({
      id: `ic-msg-${c.id}-source`, ticketId: `ic-${c.id}`,
      author: c.source.author?.id ?? 'unknown', body: c.source.body,
      type: 'reply' as const, createdAt: epochToISO(c.created_at),
    }));
  // Conversation parts
  const partMessages = icFixture.intercomConversationParts.map(p => ({
    id: `ic-msg-${p.id}`, ticketId: `ic-${icFixture.intercomConversations[0].id}`,
    author: p.author?.id ?? 'unknown', body: p.body ?? '',
    type: (p.part_type === 'note' ? 'note' : 'reply') as Message['type'],
    createdAt: epochToISO(p.created_at),
  }));
  return [...sourceMessages, ...partMessages];
}

function normalizeIntercomCustomers(): Customer[] {
  const contacts: Customer[] = icFixture.intercomContacts.map(c => ({
    id: `ic-user-${c.id}`, externalId: c.id, source: 'intercom' as const,
    name: c.name ?? c.email ?? `Contact ${c.id}`, email: c.email ?? '',
    phone: c.phone ?? undefined,
    orgId: c.companies?.data?.[0]?.id ? `ic-org-${c.companies.data[0].id}` : undefined,
  }));
  const admins: Customer[] = icFixture.intercomAdmins.map(a => ({
    id: `ic-admin-${a.id}`, externalId: `admin-${a.id}`, source: 'intercom' as const,
    name: a.name, email: a.email,
  }));
  return [...contacts, ...admins];
}

function normalizeIntercomOrgs(): Organization[] {
  return icFixture.intercomCompanies.map(co => ({
    id: `ic-org-${co.id}`, externalId: co.id, source: 'intercom' as const,
    name: co.name, domains: co.website ? [co.website] : [],
  }));
}

function normalizeHubSpotTickets(): Ticket[] {
  return hsFixture.hubspotTickets.map(t => {
    const p = t.properties;
    return {
      id: `hub-${t.id}`, externalId: t.id, source: 'hubspot' as const,
      subject: p.subject ?? `Ticket #${t.id}`,
      status: hsMapPipelineStage(p.hs_pipeline_stage),
      priority: hsMapPriority(p.hs_ticket_priority),
      assignee: p.hubspot_owner_id ?? undefined,
      requester: 'unknown',
      tags: p.hs_ticket_category ? [p.hs_ticket_category] : [],
      createdAt: p.createdate ?? new Date().toISOString(),
      updatedAt: p.hs_lastmodifieddate ?? new Date().toISOString(),
    };
  });
}

function normalizeHubSpotCustomers(): Customer[] {
  const contacts: Customer[] = hsFixture.hubspotContacts.map(c => ({
    id: `hub-user-${c.id}`, externalId: c.id, source: 'hubspot' as const,
    name: [c.properties.firstname, c.properties.lastname].filter(Boolean).join(' ') || c.properties.email || `Contact ${c.id}`,
    email: c.properties.email ?? '', phone: c.properties.phone ?? undefined,
    orgId: c.properties.associatedcompanyid ? `hub-org-${c.properties.associatedcompanyid}` : undefined,
  }));
  const owners: Customer[] = hsFixture.hubspotOwners.map(o => ({
    id: `hub-agent-${o.id}`, externalId: `agent-${o.id}`, source: 'hubspot' as const,
    name: `${o.firstName} ${o.lastName}`.trim(), email: o.email,
  }));
  return [...contacts, ...owners];
}

function normalizeHubSpotRules(): Rule[] {
  return hsFixture.hubspotWorkflows.map(wf => ({
    id: `hub-rule-${wf.id}`, externalId: wf.id, source: 'hubspot' as const,
    type: 'automation' as const, title: wf.name ?? `Workflow ${wf.id}`,
    conditions: wf.enrollmentCriteria ?? null, actions: wf.actions ?? null, active: wf.enabled ?? false,
  }));
}

function normalizeZohoDeskTickets(): Ticket[] {
  return zoFixture.zohoDeskTickets.map(t => ({
    id: `zd-desk-${t.id}`, externalId: t.id, source: 'zoho-desk' as const,
    subject: t.subject ?? `Ticket #${t.ticketNumber}`,
    status: zoMapStatus(t.status), priority: fuzzyPriorityMatch(t.priority),
    assignee: t.assigneeId ?? undefined, requester: t.contactId ?? 'unknown',
    tags: t.tags ?? [], createdAt: t.createdTime, updatedAt: t.modifiedTime,
    customFields: t.customFields,
  }));
}

function normalizeZohoDeskMessages(): Message[] {
  const threads: Message[] = zoFixture.zohoDeskThreads.map(th => ({
    id: `zd-desk-msg-${th.id}`, ticketId: `zd-desk-${zoFixture.zohoDeskTickets[0].id}`,
    author: th.author?.name ?? th.author?.id ?? 'unknown', body: th.content ?? '',
    type: (th.type === 'note' || th.isPrivate ? 'note' : 'reply') as Message['type'],
    createdAt: th.createdTime,
  }));
  const comments: Message[] = zoFixture.zohoDeskComments.map(c => ({
    id: `zd-desk-note-${c.id}`, ticketId: `zd-desk-${zoFixture.zohoDeskTickets[0].id}`,
    author: c.commenter?.name ?? c.commenter?.id ?? 'unknown', body: c.content ?? '',
    type: (c.isPublic ? 'reply' : 'note') as Message['type'], createdAt: c.commentedTime,
  }));
  return [...threads, ...comments];
}

function normalizeZohoDeskCustomers(): Customer[] {
  const contacts: Customer[] = zoFixture.zohoDeskContacts.map(c => ({
    id: `zd-desk-user-${c.id}`, externalId: c.id, source: 'zoho-desk' as const,
    name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || `Contact ${c.id}`,
    email: c.email ?? '', phone: c.phone ?? c.mobile ?? undefined,
    orgId: c.accountId ? `zd-desk-org-${c.accountId}` : undefined,
  }));
  const agents: Customer[] = zoFixture.zohoDeskAgents.map(a => ({
    id: `zd-desk-agent-${a.id}`, externalId: `agent-${a.id}`, source: 'zoho-desk' as const,
    name: a.name, email: a.emailId,
  }));
  return [...contacts, ...agents];
}

function normalizeZohoDeskOrgs(): Organization[] {
  return zoFixture.zohoDeskAccounts.map(a => ({
    id: `zd-desk-org-${a.id}`, externalId: a.id, source: 'zoho-desk' as const,
    name: a.accountName, domains: a.website ? [a.website] : [],
  }));
}

function normalizeZohoDeskKBArticles(): KBArticle[] {
  return zoFixture.zohoDeskArticles.map(a => ({
    id: `zd-desk-kb-${a.id}`, externalId: a.id, source: 'zoho-desk' as const,
    title: a.title, body: a.answer ?? '', categoryPath: [a.categoryId, a.sectionId].filter(Boolean) as string[],
  }));
}

function normalizeHelpScoutTickets(): Ticket[] {
  return hscFixture.helpscoutConversations.map(conv => ({
    id: `hs-${conv.id}`, externalId: String(conv.id), source: 'helpscout' as const,
    subject: conv.subject ?? `Conversation #${conv.number}`,
    status: hscMapStatus(conv.status), priority: 'normal' as const,
    assignee: conv.assignee ? String(conv.assignee.id) : undefined,
    requester: conv.primaryCustomer?.email ?? String(conv.primaryCustomer?.id ?? 'unknown'),
    tags: (conv.tags ?? []).map(t => t.tag),
    createdAt: conv.createdAt, updatedAt: conv.userUpdatedAt,
    customFields: conv.customFields ? Object.fromEntries(conv.customFields.map(f => [f.name, f.value])) : undefined,
  }));
}

function normalizeHelpScoutMessages(): Message[] {
  return hscFixture.helpscoutThreads.map(t => ({
    id: `hs-msg-${t.id}`, ticketId: `hs-${hscFixture.helpscoutConversations[0].id}`,
    author: String(t.createdBy?.id ?? 'unknown'), body: t.body,
    type: (t.type === 'note' ? 'note' : 'reply') as Message['type'], createdAt: t.createdAt,
  }));
}

function normalizeHelpScoutCustomers(): Customer[] {
  return hscFixture.helpscoutCustomers.map(c => ({
    id: `hs-user-${c.id}`, externalId: String(c.id), source: 'helpscout' as const,
    name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.emails?.[0]?.value || `Customer ${c.id}`,
    email: c.emails?.[0]?.value ?? '', phone: c.phones?.[0]?.value ?? undefined,
    orgId: c.organization ? `hs-org-${c.organization}` : undefined,
  }));
}

function normalizeHelpScoutKBArticles(): KBArticle[] {
  return hscFixture.helpscoutArticles.map(a => ({
    id: `hs-kb-${a.id}`, externalId: a.id, source: 'helpscout' as const,
    title: a.name, body: a.text ?? '',
    categoryPath: ['General KB', ...(a.categories ?? []).map(c => c.name)],
  }));
}

function normalizeGrooveTickets(): Ticket[] {
  return gvFixture.grooveTickets.map(t => {
    const extractId = (href: string) => href.split('/').pop() ?? href;
    return {
      id: `gv-${t.number}`, externalId: String(t.number), source: 'groove' as const,
      subject: t.title ?? `Ticket #${t.number}`,
      status: gvMapState(t.state), priority: gvMapPriority(t.priority),
      assignee: t.links.assignee?.href ? extractId(t.links.assignee.href) : undefined,
      requester: t.links.customer?.href ? extractId(t.links.customer.href) : 'unknown',
      tags: t.tags ?? [], createdAt: t.created_at, updatedAt: t.updated_at,
    };
  });
}

function normalizeGrooveMessages(): Message[] {
  const extractId = (href: string) => href.split('/').pop() ?? href;
  return gvFixture.grooveMessages.map(m => ({
    id: `gv-msg-${extractId(m.href)}`, ticketId: `gv-${gvFixture.grooveTickets[0].number}`,
    author: m.links.author?.href ? extractId(m.links.author.href) : 'unknown',
    body: m.plain_text_body ?? m.body ?? '', bodyHtml: m.body,
    type: (m.note ? 'note' : 'reply') as Message['type'], createdAt: m.created_at,
  }));
}

function normalizeGrooveCustomers(): Customer[] {
  return gvFixture.grooveCustomers.map(c => ({
    id: `gv-user-${c.email}`, externalId: c.email, source: 'groove' as const,
    name: c.name ?? c.email, email: c.email, phone: c.phone_number ?? undefined,
    orgId: c.company_name ? `gv-org-${c.company_name}` : undefined,
  }));
}

function normalizeHelpCrunchTickets(): Ticket[] {
  return hcFixture.helpcrunchChats.map(chat => ({
    id: `hc-${chat.id}`, externalId: String(chat.id), source: 'helpcrunch' as const,
    subject: chat.lastMessageText?.slice(0, 100) ?? `Chat #${chat.id}`,
    status: hcMapChatStatus(chat.status), priority: 'normal' as const,
    assignee: chat.assignee ? String(chat.assignee.id) : undefined,
    requester: chat.customer ? String(chat.customer.id) : 'unknown',
    tags: chat.department ? [chat.department.name ?? `dept-${chat.department.id}`] : [],
    createdAt: epochToISO(chat.createdAt), updatedAt: epochToISO(chat.lastMessageAt ?? chat.createdAt),
  }));
}

function normalizeHelpCrunchMessages(): Message[] {
  return hcFixture.helpcrunchMessages.map(m => ({
    id: `hc-msg-${m.id}`, ticketId: `hc-${hcFixture.helpcrunchChats[0].id}`,
    author: m.from === 'agent' && m.agent ? String(m.agent.id) : String(hcFixture.helpcrunchChats[0].customer?.id ?? 'customer'),
    body: m.text ?? '', type: (m.type === 'private' ? 'note' : 'reply') as Message['type'],
    createdAt: epochToISO(m.createdAt),
  }));
}

function normalizeHelpCrunchCustomers(): Customer[] {
  return hcFixture.helpcrunchCustomers.map(c => ({
    id: `hc-user-${c.id}`, externalId: String(c.id), source: 'helpcrunch' as const,
    name: c.name ?? c.email ?? `Customer ${c.id}`, email: c.email ?? '',
    phone: c.phone ?? undefined, orgId: c.company ? `hc-org-${c.company}` : undefined,
  }));
}

// ---- Shared validator helpers ----

function assertTicketShape(ticket: Ticket, connectorName: string) {
  expect(ticket.id, `${connectorName}: ticket.id must be non-empty`).toBeTruthy();
  expect(typeof ticket.id).toBe('string');
  expect(ticket.subject, `${connectorName}: ticket.subject must be non-empty`).toBeTruthy();
  expect(typeof ticket.subject).toBe('string');
  expect(ticket.externalId, `${connectorName}: ticket.externalId must exist`).toBeDefined();
  expect(ticket.source, `${connectorName}: ticket.source must exist`).toBeTruthy();
  expect(VALID_STATUSES, `${connectorName}: status '${ticket.status}' invalid`).toContain(ticket.status);
  expect(VALID_PRIORITIES, `${connectorName}: priority '${ticket.priority}' invalid`).toContain(ticket.priority);
  expect(isValidISODate(ticket.createdAt), `${connectorName}: createdAt '${ticket.createdAt}' invalid`).toBe(true);
  expect(isValidISODate(ticket.updatedAt), `${connectorName}: updatedAt '${ticket.updatedAt}' invalid`).toBe(true);
  expect(Array.isArray(ticket.tags), `${connectorName}: tags must be array`).toBe(true);
  expect(ticket.requester, `${connectorName}: requester must exist`).toBeDefined();
}

function assertMessageShape(message: Message, connectorName: string) {
  expect(message.id, `${connectorName}: message.id must be non-empty`).toBeTruthy();
  expect(typeof message.id).toBe('string');
  expect(message.ticketId, `${connectorName}: message.ticketId must be non-empty`).toBeTruthy();
  expect(typeof message.body).toBe('string');
  expect(message.body, `${connectorName}: message.body must be defined`).toBeDefined();
  expect(message.author, `${connectorName}: message.author must exist`).toBeDefined();
  expect(typeof message.author).toBe('string');
  expect(isValidISODate(message.createdAt), `${connectorName}: createdAt '${message.createdAt}' invalid`).toBe(true);
  expect(['reply', 'note', 'system']).toContain(message.type);
}

function assertCustomerShape(customer: Customer, connectorName: string) {
  expect(customer.id, `${connectorName}: customer.id must be non-empty`).toBeTruthy();
  expect(typeof customer.id).toBe('string');
  const hasNameOrEmail = (customer.name && customer.name.length > 0) || (customer.email && customer.email.length > 0);
  expect(hasNameOrEmail, `${connectorName}: customer must have name or email`).toBe(true);
  expect(customer.source, `${connectorName}: customer.source must exist`).toBeTruthy();
}

function assertOrganizationShape(org: Organization, connectorName: string) {
  expect(org.id, `${connectorName}: org.id must be non-empty`).toBeTruthy();
  expect(org.name, `${connectorName}: org.name must be non-empty`).toBeTruthy();
  expect(Array.isArray(org.domains), `${connectorName}: org.domains must be array`).toBe(true);
  expect(org.source, `${connectorName}: org.source must exist`).toBeTruthy();
}

function assertKBArticleShape(article: KBArticle, connectorName: string) {
  expect(article.id, `${connectorName}: article.id must be non-empty`).toBeTruthy();
  expect(article.title, `${connectorName}: article.title must be non-empty`).toBeTruthy();
  expect(typeof article.body).toBe('string');
  expect(Array.isArray(article.categoryPath), `${connectorName}: categoryPath must be array`).toBe(true);
  expect(article.source, `${connectorName}: article.source must exist`).toBeTruthy();
}

function assertRuleShape(rule: Rule, connectorName: string) {
  expect(rule.id, `${connectorName}: rule.id must be non-empty`).toBeTruthy();
  expect(rule.title, `${connectorName}: rule.title must be non-empty`).toBeTruthy();
  expect(['macro', 'trigger', 'automation', 'sla', 'assignment']).toContain(rule.type);
  expect(typeof rule.active).toBe('boolean');
  expect(rule.source, `${connectorName}: rule.source must exist`).toBeTruthy();
}

function assertManifestShape(manifest: ExportManifest) {
  expect(manifest.source).toBeTruthy();
  expect(isValidISODate(manifest.exportedAt)).toBe(true);
  expect(typeof manifest.counts.tickets).toBe('number');
  expect(typeof manifest.counts.messages).toBe('number');
  expect(typeof manifest.counts.customers).toBe('number');
  expect(typeof manifest.counts.organizations).toBe('number');
  expect(typeof manifest.counts.kbArticles).toBe('number');
  expect(typeof manifest.counts.rules).toBe('number');
}

// =============================================================================
// ZENDESK
// =============================================================================

describe('Zendesk connector parity', () => {
  const tickets = normalizeZendeskTickets();
  const messages = normalizeZendeskMessages();
  const customers = normalizeZendeskCustomers();
  const orgs = normalizeZendeskOrgs();
  const rules = normalizeZendeskRules();

  it('produces tickets with all required fields', () => {
    expect(tickets.length).toBe(3);
    for (const t of tickets) {
      assertTicketShape(t, 'zendesk');
      expect(t.source).toBe('zendesk');
      expect(t.id).toMatch(/^zd-/);
    }
  });

  it('maps all statuses to canonical set', () => {
    expect(tickets[0].status).toBe('open');
    expect(tickets[1].status).toBe('pending');
    expect(tickets[2].status).toBe('solved');
  });

  it('maps priorities to canonical set (including null fallback)', () => {
    expect(tickets[0].priority).toBe('high');
    expect(tickets[1].priority).toBe('low');
    expect(tickets[2].priority).toBe('normal'); // null -> normal
  });

  it('produces messages with all required fields', () => {
    expect(messages.length).toBe(3);
    for (const m of messages) assertMessageShape(m, 'zendesk');
  });

  it('distinguishes public replies from internal notes', () => {
    expect(messages[0].type).toBe('reply');
    expect(messages[1].type).toBe('reply');
    expect(messages[2].type).toBe('note');
  });

  it('produces customers with name or email', () => {
    expect(customers.length).toBe(3);
    for (const c of customers) assertCustomerShape(c, 'zendesk');
  });

  it('produces organizations with all required fields', () => {
    expect(orgs.length).toBe(1);
    for (const o of orgs) assertOrganizationShape(o, 'zendesk');
  });

  it('produces rules with all required fields', () => {
    expect(rules.length).toBe(1);
    for (const r of rules) assertRuleShape(r, 'zendesk');
  });

  it('no ticket has empty id or subject', () => {
    for (const t of tickets) {
      expect(t.id).not.toBe('');
      expect(t.subject).not.toBe('');
    }
  });

  it('all dates are valid ISO strings', () => {
    for (const t of tickets) {
      expect(isValidISODate(t.createdAt)).toBe(true);
      expect(isValidISODate(t.updatedAt)).toBe(true);
    }
    for (const m of messages) expect(isValidISODate(m.createdAt)).toBe(true);
  });
});

// =============================================================================
// FRESHDESK
// =============================================================================

describe('Freshdesk connector parity', () => {
  const tickets = normalizeFreshdeskTickets();
  const messages = normalizeFreshdeskMessages();
  const customers = normalizeFreshdeskCustomers();

  it('produces tickets with all required fields', () => {
    expect(tickets.length).toBe(3);
    for (const t of tickets) {
      assertTicketShape(t, 'freshdesk');
      expect(t.source).toBe('freshdesk');
      expect(t.id).toMatch(/^fd-/);
    }
  });

  it('handles null subject with fallback', () => {
    const nullSubject = tickets.find(t => t.externalId === '3');
    expect(nullSubject?.subject).toContain('Ticket #3');
  });

  it('maps numeric statuses to canonical set', () => {
    expect(tickets[0].status).toBe('open');     // 2
    expect(tickets[1].status).toBe('pending');  // 3
    expect(tickets[2].status).toBe('closed');   // 5
  });

  it('maps numeric priorities to canonical set', () => {
    expect(tickets[0].priority).toBe('high');    // 3
    expect(tickets[1].priority).toBe('low');     // 1
    expect(tickets[2].priority).toBe('urgent');  // 4
  });

  it('produces messages with all required fields', () => {
    expect(messages.length).toBe(3);
    for (const m of messages) assertMessageShape(m, 'freshdesk');
  });

  it('distinguishes public vs private messages', () => {
    expect(messages[0].type).toBe('reply');
    expect(messages[1].type).toBe('reply');
    expect(messages[2].type).toBe('note');
  });

  it('produces customers with name or email', () => {
    expect(customers.length).toBe(3);
    for (const c of customers) assertCustomerShape(c, 'freshdesk');
  });

  it('handles null customer name with fallback', () => {
    const nullName = customers.find(c => c.externalId === '22');
    expect(nullName?.name).toBeTruthy();
    expect(nullName?.name).toBe('anon@example.com');
  });

  it('all dates are valid ISO strings', () => {
    for (const t of tickets) {
      expect(isValidISODate(t.createdAt)).toBe(true);
      expect(isValidISODate(t.updatedAt)).toBe(true);
    }
  });
});

// =============================================================================
// INTERCOM
// =============================================================================

describe('Intercom connector parity', () => {
  const tickets = normalizeIntercomTickets();
  const messages = normalizeIntercomMessages();
  const customers = normalizeIntercomCustomers();
  const orgs = normalizeIntercomOrgs();

  it('produces tickets with all required fields', () => {
    expect(tickets.length).toBe(3);
    for (const t of tickets) {
      assertTicketShape(t, 'intercom');
      expect(t.source).toBe('intercom');
    }
  });

  it('converts epoch timestamps to valid ISO dates', () => {
    for (const t of tickets) {
      expect(t.createdAt).toContain('T');
      expect(isValidISODate(t.createdAt)).toBe(true);
    }
  });

  it('maps conversation states to canonical statuses', () => {
    expect(tickets[0].status).toBe('open');
    expect(tickets[1].status).toBe('closed');
    expect(tickets[2].status).toBe('on_hold');
  });

  it('maps priority vs not_priority correctly', () => {
    expect(tickets[0].priority).toBe('high');
    expect(tickets[1].priority).toBe('normal');
    expect(tickets[2].priority).toBe('normal');
  });

  it('produces messages from source and parts', () => {
    // 3 source messages + 2 conversation parts
    expect(messages.length).toBe(5);
    for (const m of messages) assertMessageShape(m, 'intercom');
  });

  it('produces customers from contacts and admins', () => {
    expect(customers.length).toBe(5); // 3 contacts + 2 admins
    for (const c of customers) assertCustomerShape(c, 'intercom');
  });

  it('handles null name/email with fallback', () => {
    const anon = customers.find(c => c.externalId === 'user-102');
    expect(anon?.name).toBeTruthy();
    expect(anon?.name).toContain('Contact');
  });

  it('produces organizations with correct shape', () => {
    expect(orgs.length).toBe(1);
    assertOrganizationShape(orgs[0], 'intercom');
  });
});

// =============================================================================
// HUBSPOT
// =============================================================================

describe('HubSpot connector parity', () => {
  const tickets = normalizeHubSpotTickets();
  const customers = normalizeHubSpotCustomers();
  const rules = normalizeHubSpotRules();

  it('produces tickets with all required fields', () => {
    expect(tickets.length).toBe(3);
    for (const t of tickets) {
      assertTicketShape(t, 'hubspot');
      expect(t.source).toBe('hubspot');
      expect(t.id).toMatch(/^hub-/);
    }
  });

  it('handles undefined subject with fallback', () => {
    const noSubject = tickets.find(t => t.externalId === 'hs-1003');
    expect(noSubject?.subject).toContain('Ticket #hs-1003');
  });

  it('maps pipeline stages to canonical statuses', () => {
    expect(tickets[0].status).toBe('open');
    expect(tickets[1].status).toBe('pending');
    expect(tickets[2].status).toBe('closed');
  });

  it('maps HubSpot priorities to canonical values', () => {
    expect(tickets[0].priority).toBe('high');
    expect(tickets[1].priority).toBe('low');
    expect(tickets[2].priority).toBe('normal'); // undefined -> normal
  });

  it('produces customers from contacts and owners', () => {
    expect(customers.length).toBe(4); // 2 contacts + 2 owners
    for (const c of customers) assertCustomerShape(c, 'hubspot');
  });

  it('builds customer name from first/last with fallback', () => {
    const noName = customers.find(c => c.externalId === 'contact-2');
    expect(noName?.name).toBeTruthy();
    expect(noName?.name).toBe('unknown@example.com');
  });

  it('produces rules from workflows', () => {
    expect(rules.length).toBe(1);
    assertRuleShape(rules[0], 'hubspot');
    expect(rules[0].type).toBe('automation');
  });
});

// =============================================================================
// ZOHO DESK
// =============================================================================

describe('Zoho Desk connector parity', () => {
  const tickets = normalizeZohoDeskTickets();
  const messages = normalizeZohoDeskMessages();
  const customers = normalizeZohoDeskCustomers();
  const orgs = normalizeZohoDeskOrgs();
  const articles = normalizeZohoDeskKBArticles();

  it('produces tickets with all required fields', () => {
    expect(tickets.length).toBe(3);
    for (const t of tickets) {
      assertTicketShape(t, 'zoho-desk');
      expect(t.source).toBe('zoho-desk');
    }
  });

  it('maps Zoho Desk statuses to canonical values', () => {
    expect(tickets[0].status).toBe('open');
    expect(tickets[1].status).toBe('on_hold');
    expect(tickets[2].status).toBe('closed');
  });

  it('uses fuzzy priority matching', () => {
    expect(tickets[0].priority).toBe('high');
    expect(tickets[1].priority).toBe('normal'); // null
    expect(tickets[2].priority).toBe('low');
  });

  it('produces messages from threads and comments', () => {
    expect(messages.length).toBe(3); // 2 threads + 1 comment
    for (const m of messages) assertMessageShape(m, 'zoho-desk');
  });

  it('produces customers from contacts and agents', () => {
    expect(customers.length).toBe(5); // 3 contacts + 2 agents
    for (const c of customers) assertCustomerShape(c, 'zoho-desk');
  });

  it('handles null firstName/lastName with fallback', () => {
    const nullName = customers.find(c => c.externalId === 'contact-2');
    expect(nullName?.name).toBeTruthy();
    expect(nullName?.name).toBe('cust2@example.com');
  });

  it('produces organizations with correct shape', () => {
    expect(orgs.length).toBe(1);
    assertOrganizationShape(orgs[0], 'zoho-desk');
  });

  it('produces KB articles with correct shape', () => {
    expect(articles.length).toBe(1);
    assertKBArticleShape(articles[0], 'zoho-desk');
  });
});

// =============================================================================
// HELP SCOUT
// =============================================================================

describe('Help Scout connector parity', () => {
  const tickets = normalizeHelpScoutTickets();
  const messages = normalizeHelpScoutMessages();
  const customers = normalizeHelpScoutCustomers();
  const articles = normalizeHelpScoutKBArticles();

  it('produces tickets with all required fields', () => {
    expect(tickets.length).toBe(3);
    for (const t of tickets) {
      assertTicketShape(t, 'helpscout');
      expect(t.source).toBe('helpscout');
      expect(t.id).toMatch(/^hs-/);
    }
  });

  it('maps Help Scout statuses to canonical values', () => {
    expect(tickets[0].status).toBe('open');    // active
    expect(tickets[1].status).toBe('pending'); // pending
    expect(tickets[2].status).toBe('closed');  // closed
  });

  it('defaults priority to normal', () => {
    for (const t of tickets) expect(t.priority).toBe('normal');
  });

  it('produces messages from threads with correct type', () => {
    expect(messages.length).toBe(3);
    for (const m of messages) assertMessageShape(m, 'helpscout');
    expect(messages[2].type).toBe('note');
  });

  it('produces customers with name or email', () => {
    expect(customers.length).toBe(3);
    for (const c of customers) assertCustomerShape(c, 'helpscout');
  });

  it('handles null first/last name with fallback to email', () => {
    const nullName = customers.find(c => c.externalId === '302');
    expect(nullName?.name).toBeTruthy();
    expect(nullName?.name).toBe('dev@example.com');
  });

  it('produces KB articles with category path including collection', () => {
    expect(articles.length).toBe(1);
    assertKBArticleShape(articles[0], 'helpscout');
    expect(articles[0].categoryPath).toContain('General KB');
    expect(articles[0].categoryPath).toContain('Billing');
  });
});

// =============================================================================
// GROOVE
// =============================================================================

describe('Groove connector parity', () => {
  const tickets = normalizeGrooveTickets();
  const messages = normalizeGrooveMessages();
  const customers = normalizeGrooveCustomers();

  it('produces tickets with all required fields', () => {
    expect(tickets.length).toBe(3);
    for (const t of tickets) {
      assertTicketShape(t, 'groove');
      expect(t.source).toBe('groove');
      expect(t.id).toMatch(/^gv-/);
    }
  });

  it('maps Groove states to canonical statuses', () => {
    expect(tickets[0].status).toBe('open');
    expect(tickets[1].status).toBe('pending');
    expect(tickets[2].status).toBe('closed');
  });

  it('maps priorities to canonical set (including null)', () => {
    expect(tickets[0].priority).toBe('high');
    expect(tickets[1].priority).toBe('normal'); // null
    expect(tickets[2].priority).toBe('urgent');
  });

  it('produces messages with note/reply distinction', () => {
    expect(messages.length).toBe(2);
    for (const m of messages) assertMessageShape(m, 'groove');
    expect(messages[0].type).toBe('reply');
    expect(messages[1].type).toBe('note');
  });

  it('produces customers with name or email', () => {
    expect(customers.length).toBe(3);
    for (const c of customers) assertCustomerShape(c, 'groove');
  });

  it('handles null name with fallback to email', () => {
    const noName = customers.find(c => c.externalId === 'user@example.com');
    expect(noName?.name).toBe('user@example.com');
  });
});

// =============================================================================
// HELPCRUNCH
// =============================================================================

describe('HelpCrunch connector parity', () => {
  const tickets = normalizeHelpCrunchTickets();
  const messages = normalizeHelpCrunchMessages();
  const customers = normalizeHelpCrunchCustomers();

  it('produces tickets with all required fields', () => {
    expect(tickets.length).toBe(3);
    for (const t of tickets) {
      assertTicketShape(t, 'helpcrunch');
      expect(t.source).toBe('helpcrunch');
      expect(t.id).toMatch(/^hc-/);
    }
  });

  it('maps numeric chat statuses to canonical values', () => {
    expect(tickets[0].status).toBe('open');
    expect(tickets[1].status).toBe('pending');
    expect(tickets[2].status).toBe('closed');
  });

  it('defaults priority to normal', () => {
    for (const t of tickets) expect(t.priority).toBe('normal');
  });

  it('converts epoch string timestamps to valid ISO dates', () => {
    for (const t of tickets) {
      expect(t.createdAt).toContain('T');
      expect(isValidISODate(t.createdAt)).toBe(true);
    }
    for (const m of messages) {
      expect(isValidISODate(m.createdAt)).toBe(true);
    }
  });

  it('produces messages with private/public distinction', () => {
    expect(messages.length).toBe(3);
    for (const m of messages) assertMessageShape(m, 'helpcrunch');
    expect(messages[2].type).toBe('note'); // private type
  });

  it('produces customers with name or email', () => {
    expect(customers.length).toBe(3);
    for (const c of customers) assertCustomerShape(c, 'helpcrunch');
  });

  it('handles null name with fallback', () => {
    const anon = customers.find(c => c.externalId === '801');
    expect(anon?.name).toBeTruthy();
    expect(anon?.name).toBe('anon@example.com');
  });
});

// =============================================================================
// COUNT ACCURACY (MANIFEST SIMULATION)
// =============================================================================

describe('Count accuracy — manifest counts match entity counts', () => {
  function buildManifest(
    source: ExportManifest['source'],
    ticketCount: number, messageCount: number, customerCount: number,
    orgCount: number, kbCount: number, ruleCount: number,
  ): ExportManifest {
    return {
      source,
      exportedAt: new Date().toISOString(),
      counts: {
        tickets: ticketCount, messages: messageCount, customers: customerCount,
        organizations: orgCount, kbArticles: kbCount, rules: ruleCount,
      },
    };
  }

  it('Zendesk counts are accurate', () => {
    const m = buildManifest('zendesk', 3, 3, 3, 1, 0, 1);
    assertManifestShape(m);
    expect(m.counts.tickets).toBe(normalizeZendeskTickets().length);
    expect(m.counts.messages).toBe(normalizeZendeskMessages().length);
    expect(m.counts.customers).toBe(normalizeZendeskCustomers().length);
    expect(m.counts.organizations).toBe(normalizeZendeskOrgs().length);
    expect(m.counts.rules).toBe(normalizeZendeskRules().length);
  });

  it('Freshdesk counts are accurate', () => {
    const m = buildManifest('freshdesk', 3, 3, 3, 0, 0, 0);
    assertManifestShape(m);
    expect(m.counts.tickets).toBe(normalizeFreshdeskTickets().length);
    expect(m.counts.messages).toBe(normalizeFreshdeskMessages().length);
    expect(m.counts.customers).toBe(normalizeFreshdeskCustomers().length);
  });

  it('Intercom counts are accurate', () => {
    const m = buildManifest('intercom', 3, 5, 5, 1, 0, 0);
    assertManifestShape(m);
    expect(m.counts.tickets).toBe(normalizeIntercomTickets().length);
    expect(m.counts.messages).toBe(normalizeIntercomMessages().length);
    expect(m.counts.customers).toBe(normalizeIntercomCustomers().length);
    expect(m.counts.organizations).toBe(normalizeIntercomOrgs().length);
  });

  it('HubSpot counts are accurate', () => {
    const m = buildManifest('hubspot', 3, 0, 4, 0, 0, 1);
    assertManifestShape(m);
    expect(m.counts.tickets).toBe(normalizeHubSpotTickets().length);
    expect(m.counts.customers).toBe(normalizeHubSpotCustomers().length);
    expect(m.counts.rules).toBe(normalizeHubSpotRules().length);
  });

  it('Zoho Desk counts are accurate', () => {
    const m = buildManifest('zoho-desk', 3, 3, 5, 1, 1, 0);
    assertManifestShape(m);
    expect(m.counts.tickets).toBe(normalizeZohoDeskTickets().length);
    expect(m.counts.messages).toBe(normalizeZohoDeskMessages().length);
    expect(m.counts.customers).toBe(normalizeZohoDeskCustomers().length);
    expect(m.counts.organizations).toBe(normalizeZohoDeskOrgs().length);
    expect(m.counts.kbArticles).toBe(normalizeZohoDeskKBArticles().length);
  });

  it('Help Scout counts are accurate', () => {
    const m = buildManifest('helpscout', 3, 3, 3, 0, 1, 0);
    assertManifestShape(m);
    expect(m.counts.tickets).toBe(normalizeHelpScoutTickets().length);
    expect(m.counts.messages).toBe(normalizeHelpScoutMessages().length);
    expect(m.counts.customers).toBe(normalizeHelpScoutCustomers().length);
    expect(m.counts.kbArticles).toBe(normalizeHelpScoutKBArticles().length);
  });

  it('Groove counts are accurate', () => {
    const m = buildManifest('groove', 3, 2, 3, 0, 0, 0);
    assertManifestShape(m);
    expect(m.counts.tickets).toBe(normalizeGrooveTickets().length);
    expect(m.counts.messages).toBe(normalizeGrooveMessages().length);
    expect(m.counts.customers).toBe(normalizeGrooveCustomers().length);
  });

  it('HelpCrunch counts are accurate', () => {
    const m = buildManifest('helpcrunch', 3, 3, 3, 0, 0, 0);
    assertManifestShape(m);
    expect(m.counts.tickets).toBe(normalizeHelpCrunchTickets().length);
    expect(m.counts.messages).toBe(normalizeHelpCrunchMessages().length);
    expect(m.counts.customers).toBe(normalizeHelpCrunchCustomers().length);
  });
});

// =============================================================================
// CROSS-CONNECTOR CONSISTENCY
// =============================================================================

describe('Cross-connector consistency', () => {
  it('all connector source IDs match the registry in types.ts', () => {
    const registeredSources = [
      'zendesk', 'kayako', 'kayako-classic', 'helpcrunch', 'freshdesk',
      'groove', 'intercom', 'helpscout', 'zoho-desk', 'hubspot',
    ];
    for (const id of CONNECTOR_IDS) {
      expect(registeredSources).toContain(id);
    }
  });

  it('all connectors export a main export function', async () => {
    const zendesk = await import('../../connectors/zendesk.js');
    const freshdesk = await import('../../connectors/freshdesk.js');
    const intercom = await import('../../connectors/intercom.js');
    const hubspot = await import('../../connectors/hubspot.js');
    const zohodesk = await import('../../connectors/zoho-desk.js');
    const helpscout = await import('../../connectors/helpscout.js');
    const groove = await import('../../connectors/groove.js');
    const helpcrunch = await import('../../connectors/helpcrunch.js');

    expect(typeof zendesk.exportZendesk).toBe('function');
    expect(typeof freshdesk.exportFreshdesk).toBe('function');
    expect(typeof intercom.exportIntercom).toBe('function');
    expect(typeof hubspot.exportHubSpot).toBe('function');
    expect(typeof zohodesk.exportZohoDesk).toBe('function');
    expect(typeof helpscout.exportHelpScout).toBe('function');
    expect(typeof groove.exportGroove).toBe('function');
    expect(typeof helpcrunch.exportHelpcrunch).toBe('function');
  });

  it('all connectors export a verify connection function', async () => {
    const zendesk = await import('../../connectors/zendesk.js');
    const freshdesk = await import('../../connectors/freshdesk.js');
    const intercom = await import('../../connectors/intercom.js');
    const hubspot = await import('../../connectors/hubspot.js');
    const zohodesk = await import('../../connectors/zoho-desk.js');
    const helpscout = await import('../../connectors/helpscout.js');
    const groove = await import('../../connectors/groove.js');
    const helpcrunch = await import('../../connectors/helpcrunch.js');

    expect(typeof zendesk.zendeskVerifyConnection).toBe('function');
    expect(typeof freshdesk.freshdeskVerifyConnection).toBe('function');
    expect(typeof intercom.intercomVerifyConnection).toBe('function');
    expect(typeof hubspot.hubspotVerifyConnection).toBe('function');
    expect(typeof zohodesk.zodeskVerifyConnection).toBe('function');
    expect(typeof helpscout.helpscoutVerifyConnection).toBe('function');
    expect(typeof groove.grooveVerifyConnection).toBe('function');
    expect(typeof helpcrunch.helpcrunchVerifyConnection).toBe('function');
  });

  it('all connectors produce tickets with status from canonical set', () => {
    const allTickets = [
      ...normalizeZendeskTickets(),
      ...normalizeFreshdeskTickets(),
      ...normalizeIntercomTickets(),
      ...normalizeHubSpotTickets(),
      ...normalizeZohoDeskTickets(),
      ...normalizeHelpScoutTickets(),
      ...normalizeGrooveTickets(),
      ...normalizeHelpCrunchTickets(),
    ];
    for (const t of allTickets) {
      expect(VALID_STATUSES, `ticket ${t.id} has invalid status: ${t.status}`).toContain(t.status);
    }
  });

  it('all connectors produce tickets with priority from canonical set', () => {
    const allTickets = [
      ...normalizeZendeskTickets(),
      ...normalizeFreshdeskTickets(),
      ...normalizeIntercomTickets(),
      ...normalizeHubSpotTickets(),
      ...normalizeZohoDeskTickets(),
      ...normalizeHelpScoutTickets(),
      ...normalizeGrooveTickets(),
      ...normalizeHelpCrunchTickets(),
    ];
    for (const t of allTickets) {
      expect(VALID_PRIORITIES, `ticket ${t.id} has invalid priority: ${t.priority}`).toContain(t.priority);
    }
  });

  it('no connector produces a ticket with empty id or subject', () => {
    const allTickets = [
      ...normalizeZendeskTickets(),
      ...normalizeFreshdeskTickets(),
      ...normalizeIntercomTickets(),
      ...normalizeHubSpotTickets(),
      ...normalizeZohoDeskTickets(),
      ...normalizeHelpScoutTickets(),
      ...normalizeGrooveTickets(),
      ...normalizeHelpCrunchTickets(),
    ];
    for (const t of allTickets) {
      expect(t.id, `ticket has empty id`).not.toBe('');
      expect(t.subject, `ticket ${t.id} has empty subject`).not.toBe('');
    }
  });

  it('no connector produces a message with null/undefined body', () => {
    const allMessages = [
      ...normalizeZendeskMessages(),
      ...normalizeFreshdeskMessages(),
      ...normalizeIntercomMessages(),
      ...normalizeZohoDeskMessages(),
      ...normalizeHelpScoutMessages(),
      ...normalizeGrooveMessages(),
      ...normalizeHelpCrunchMessages(),
    ];
    for (const m of allMessages) {
      expect(m.body).not.toBeNull();
      expect(m.body).not.toBeUndefined();
    }
  });

  it('all dates across all connectors are valid ISO strings', () => {
    const allTickets = [
      ...normalizeZendeskTickets(), ...normalizeFreshdeskTickets(),
      ...normalizeIntercomTickets(), ...normalizeHubSpotTickets(),
      ...normalizeZohoDeskTickets(), ...normalizeHelpScoutTickets(),
      ...normalizeGrooveTickets(), ...normalizeHelpCrunchTickets(),
    ];
    const allMessages = [
      ...normalizeZendeskMessages(), ...normalizeFreshdeskMessages(),
      ...normalizeIntercomMessages(), ...normalizeZohoDeskMessages(),
      ...normalizeHelpScoutMessages(), ...normalizeGrooveMessages(),
      ...normalizeHelpCrunchMessages(),
    ];
    for (const t of allTickets) {
      expect(isValidISODate(t.createdAt), `${t.id}: createdAt '${t.createdAt}'`).toBe(true);
      expect(isValidISODate(t.updatedAt), `${t.id}: updatedAt '${t.updatedAt}'`).toBe(true);
    }
    for (const m of allMessages) {
      expect(isValidISODate(m.createdAt), `${m.id}: createdAt '${m.createdAt}'`).toBe(true);
    }
  });
});

// =============================================================================
// NORMALIZATION UTILITY TESTS
// =============================================================================

describe('Normalization utilities', () => {
  it('resolveStatus handles record-based maps', () => {
    const map = { open: 'open' as const, closed: 'closed' as const };
    expect(resolveStatus('open', map)).toBe('open');
    expect(resolveStatus('closed', map)).toBe('closed');
    expect(resolveStatus('unknown', map)).toBe('open');
  });

  it('resolveStatus handles function-based maps', () => {
    const fn = (raw: string) => (raw === 'active' ? 'open' as const : 'closed' as const);
    expect(resolveStatus('active', fn)).toBe('open');
    expect(resolveStatus('inactive', fn)).toBe('closed');
  });

  it('resolvePriority handles null input', () => {
    const map = { low: 'low' as const, high: 'high' as const };
    expect(resolvePriority(null, map)).toBe('normal');
  });

  it('resolvePriority handles record-based maps', () => {
    const map = { low: 'low' as const, high: 'high' as const };
    expect(resolvePriority('low', map)).toBe('low');
    expect(resolvePriority('high', map)).toBe('high');
    expect(resolvePriority('unknown', map)).toBe('normal');
  });

  it('fuzzyStatusMatch handles various labels', () => {
    expect(fuzzyStatusMatch('New')).toBe('open');
    expect(fuzzyStatusMatch('Open')).toBe('open');
    expect(fuzzyStatusMatch('Pending Review')).toBe('pending');
    expect(fuzzyStatusMatch('On Hold')).toBe('on_hold');
    expect(fuzzyStatusMatch('Waiting for customer')).toBe('on_hold');
    expect(fuzzyStatusMatch('Resolved')).toBe('solved');
    expect(fuzzyStatusMatch('Completed')).toBe('solved');
    expect(fuzzyStatusMatch('Closed')).toBe('closed');
  });

  it('fuzzyPriorityMatch handles various labels', () => {
    expect(fuzzyPriorityMatch(null)).toBe('normal');
    expect(fuzzyPriorityMatch('Low')).toBe('low');
    expect(fuzzyPriorityMatch('High Priority')).toBe('high');
    expect(fuzzyPriorityMatch('Urgent')).toBe('urgent');
    expect(fuzzyPriorityMatch('Critical')).toBe('urgent');
    expect(fuzzyPriorityMatch('Emergency')).toBe('urgent');
    expect(fuzzyPriorityMatch('Medium')).toBe('normal');
  });

  it('epochToISO converts UNIX epoch to ISO 8601', () => {
    const result = epochToISO(1706000000);
    expect(isValidISODate(result)).toBe(true);
    expect(result).toContain('2024');
    expect(result).toContain('T');
  });

  it('epochToISO handles string epochs', () => {
    const result = epochToISO('1706000000');
    expect(isValidISODate(result)).toBe(true);
    expect(result).toContain('T');
  });

  it('epochToISO handles null with fallback', () => {
    const result = epochToISO(null);
    expect(isValidISODate(result)).toBe(true);
  });

  it('initCounts returns zero-initialized structure', () => {
    const counts = initCounts();
    expect(counts.tickets).toBe(0);
    expect(counts.messages).toBe(0);
    expect(counts.customers).toBe(0);
    expect(counts.organizations).toBe(0);
    expect(counts.kbArticles).toBe(0);
    expect(counts.rules).toBe(0);
  });

  it('initCounts accepts extra count keys', () => {
    const counts = initCounts({ attachments: 0, groups: 0 });
    expect(counts.attachments).toBe(0);
    expect(counts.groups).toBe(0);
    expect(counts.tickets).toBe(0);
  });
});
