/**
 * Web data layer — delegates to the DataProvider abstraction.
 *
 * All reads and writes go through getDataProvider(), which resolves the
 * correct backend (JSONL, DB, Remote, Hybrid) based on CLIAAS_MODE / DATABASE_URL.
 *
 * This file re-exports the canonical types and keeps backward-compatible
 * function signatures so existing web routes and components don't change.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { getDataProvider } from '@/lib/data-provider/index';

// Re-export canonical types from the DataProvider
export type {
  Ticket,
  Message,
  KBArticle,
  Customer,
  Organization,
  RuleRecord,
  CSATRating,
  SurveyType,
  SurveyResponse,
  SurveyConfig,
} from '@/lib/data-provider/types';

import type { Ticket } from '@/lib/data-provider/types';

export interface TicketStats {
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byAssignee: Record<string, number>;
  topTags: Array<{ tag: string; count: number }>;
  recentTickets: Ticket[];
}

// ---- Export dir helper (still needed by some web routes) ----

const EXPORT_DIRS = [
  '/tmp/cliaas-demo',
  './exports/zendesk',
  './exports/kayako',
  './exports/kayako-classic',
  './exports/helpcrunch',
  './exports/freshdesk',
  './exports/groove',
  './exports',
];

export function findExportDir(): string | null {
  for (const dir of EXPORT_DIRS) {
    if (existsSync(join(dir, 'manifest.json'))) return dir;
  }
  return null;
}

// ---- Public read API (delegates to DataProvider) ----

export async function loadTickets(): Promise<Ticket[]> {
  const provider = await getDataProvider();
  return provider.loadTickets();
}

export async function loadMessages(ticketId?: string) {
  const provider = await getDataProvider();
  return provider.loadMessages(ticketId);
}

export async function loadKBArticles() {
  const provider = await getDataProvider();
  return provider.loadKBArticles();
}

export async function loadCustomers() {
  const provider = await getDataProvider();
  return provider.loadCustomers();
}

export async function loadOrganizations() {
  const provider = await getDataProvider();
  return provider.loadOrganizations();
}

export async function loadRules() {
  const provider = await getDataProvider();
  return provider.loadRules();
}

export async function loadCSATRatings() {
  const provider = await getDataProvider();
  return provider.loadCSATRatings();
}

export async function loadSurveyResponses(type?: import('@/lib/data-provider/types').SurveyType) {
  const provider = await getDataProvider();
  return provider.loadSurveyResponses(type);
}

export async function loadSurveyConfigs() {
  const provider = await getDataProvider();
  return provider.loadSurveyConfigs();
}

// ---- Write operations (delegate to DataProvider) ----

export async function updateTicket(
  ticketId: string,
  updates: Partial<Pick<Ticket, 'status' | 'priority' | 'subject'>>,
): Promise<void> {
  const provider = await getDataProvider();
  return provider.updateTicket(ticketId, updates);
}

export async function createKBArticle(article: {
  title: string;
  body: string;
  categoryPath?: string[];
  status?: string;
}): Promise<{ id: string }> {
  const provider = await getDataProvider();
  return provider.createKBArticle(article);
}

export async function createMessage(message: {
  ticketId: string;
  body: string;
  authorType?: 'user' | 'customer' | 'system';
  authorId?: string;
  visibility?: 'public' | 'internal';
}): Promise<{ id: string }> {
  const provider = await getDataProvider();
  return provider.createMessage(message);
}

// ---- Stats (pure computation, backend-agnostic) ----

export function computeStats(tickets: Ticket[]): TicketStats {
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byAssignee: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};

  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
    const assignee = t.assignee ?? 'unassigned';
    byAssignee[assignee] = (byAssignee[assignee] ?? 0) + 1;
    for (const tag of t.tags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }

  const topTags = Object.entries(tagCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  const recentTickets = [...tickets]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  return { total: tickets.length, byStatus, byPriority, byAssignee, topTags, recentTickets };
}
