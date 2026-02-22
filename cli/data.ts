import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Ticket, Message, KBArticle } from './schema/types.js';

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

export function findExportDir(): string {
  // Check common export locations
  const candidates = ['./exports/zendesk', './exports/kayako', './exports'];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'manifest.json'))) return dir;
  }
  return './exports/zendesk';
}

export function loadTickets(dir?: string): Ticket[] {
  const exportDir = dir ?? findExportDir();
  return readJsonl<Ticket>(join(exportDir, 'tickets.jsonl'));
}

export function loadMessages(dir?: string): Message[] {
  const exportDir = dir ?? findExportDir();
  return readJsonl<Message>(join(exportDir, 'messages.jsonl'));
}

export function loadKBArticles(dir?: string): KBArticle[] {
  const exportDir = dir ?? findExportDir();
  return readJsonl<KBArticle>(join(exportDir, 'kb_articles.jsonl'));
}

export function getTicketMessages(ticketId: string, messages: Message[]): Message[] {
  return messages.filter(m => m.ticketId === ticketId);
}
