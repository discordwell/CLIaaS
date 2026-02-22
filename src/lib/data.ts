import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Canonical types (subset for web display)
export interface Ticket {
  id: string;
  externalId: string;
  source: 'zendesk' | 'kayako';
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
  './exports',
];

export function findExportDir(): string | null {
  for (const dir of EXPORT_DIRS) {
    if (existsSync(join(dir, 'manifest.json'))) return dir;
  }
  return null;
}

export function loadTickets(): Ticket[] {
  const dir = findExportDir();
  if (!dir) return [];
  return readJsonl<Ticket>(join(dir, 'tickets.jsonl'));
}

export function loadMessages(): Message[] {
  const dir = findExportDir();
  if (!dir) return [];
  return readJsonl<Message>(join(dir, 'messages.jsonl'));
}

export function loadKBArticles(): KBArticle[] {
  const dir = findExportDir();
  if (!dir) return [];
  return readJsonl<KBArticle>(join(dir, 'kb_articles.jsonl'));
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
