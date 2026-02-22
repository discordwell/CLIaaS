import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Canonical types (subset for web display)
export interface Ticket {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako' | 'kayako-classic';
  subject: string;
  status: string;
  priority: string;
  assignee?: string | null;
  requester: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  ticketId: string;
  author: string;
  body: string;
  type: 'reply' | 'note' | 'system';
  createdAt: string;
}

export interface KBArticle {
  id: string;
  title: string;
  body: string;
  categoryPath: string[];
}

export interface TicketStats {
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byAssignee: Record<string, number>;
  topTags: Array<{ tag: string; count: number }>;
  recentTickets: Ticket[];
}

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const results: T[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      results.push(JSON.parse(line) as T);
    } catch {
      // Skip malformed lines
    }
  }
  return results;
}

const EXPORT_DIRS = [
  '/tmp/cliaas-demo',
  './exports/zendesk',
  './exports/kayako',
  './exports/kayako-classic',
  './exports',
];

export function findExportDir(): string | null {
  for (const dir of EXPORT_DIRS) {
    if (existsSync(join(dir, 'manifest.json'))) return dir;
  }
  return null;
}

function findAllExportDirs(): string[] {
  return EXPORT_DIRS.filter(dir => existsSync(join(dir, 'manifest.json')));
}

function loadAllFromDirs<T>(filename: string): T[] {
  const dirs = findAllExportDirs();
  const seen = new Set<string>();
  const results: T[] = [];

  for (const dir of dirs) {
    for (const item of readJsonl<T & { id?: string }>(join(dir, filename))) {
      const key = item.id ?? JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        results.push(item);
      }
    }
  }
  return results;
}

export function loadTickets(): Ticket[] {
  return loadAllFromDirs<Ticket>('tickets.jsonl');
}

export function loadMessages(): Message[] {
  return loadAllFromDirs<Message>('messages.jsonl');
}

export function loadKBArticles(): KBArticle[] {
  return loadAllFromDirs<KBArticle>('kb_articles.jsonl');
}

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
