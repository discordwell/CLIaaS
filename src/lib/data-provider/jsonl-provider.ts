/**
 * JsonlProvider — reads JSONL export files. BYOC / demo backend.
 * Writes are not supported (throws).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type {
  DataProvider,
  ProviderCapabilities,
  Ticket,
  Message,
  KBArticle,
  Customer,
  Organization,
  RuleRecord,
  CSATRating,
  TicketCreateParams,
  TicketUpdateParams,
  MessageCreateParams,
  KBArticleCreateParams,
} from './types';

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

function findAllExportDirs(overrideDir?: string): string[] {
  if (overrideDir) {
    return existsSync(join(overrideDir, 'manifest.json')) ? [overrideDir] : [];
  }
  return EXPORT_DIRS.filter(dir => existsSync(join(dir, 'manifest.json')));
}

function loadAllFromDirs<T>(filename: string, overrideDir?: string): T[] {
  const dirs = findAllExportDirs(overrideDir);
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

export class JsonlProvider implements DataProvider {
  readonly capabilities: ProviderCapabilities = {
    mode: 'local',
    supportsWrite: false,
    supportsSync: false,
    supportsRag: false,
  };

  private dir?: string;

  constructor(dir?: string) {
    this.dir = dir;
  }

  async loadTickets(): Promise<Ticket[]> {
    return loadAllFromDirs<Ticket>('tickets.jsonl', this.dir);
  }

  async loadMessages(ticketId?: string): Promise<Message[]> {
    const messages = loadAllFromDirs<Message>('messages.jsonl', this.dir);
    return ticketId ? messages.filter(m => m.ticketId === ticketId) : messages;
  }

  async loadKBArticles(): Promise<KBArticle[]> {
    return loadAllFromDirs<KBArticle>('kb_articles.jsonl', this.dir);
  }

  async loadCustomers(): Promise<Customer[]> {
    return loadAllFromDirs<Customer>('customers.jsonl', this.dir);
  }

  async loadOrganizations(): Promise<Organization[]> {
    return loadAllFromDirs<Organization>('organizations.jsonl', this.dir);
  }

  async loadRules(): Promise<RuleRecord[]> {
    return loadAllFromDirs<RuleRecord>('rules.jsonl', this.dir);
  }

  async loadCSATRatings(): Promise<CSATRating[]> {
    return [];
  }

  async createTicket(_params: TicketCreateParams): Promise<{ id: string }> {
    throw new Error('Write operations require a database. Configure mode: db or hybrid.');
  }

  async updateTicket(_ticketId: string, _params: TicketUpdateParams): Promise<void> {
    throw new Error('Write operations require a database. Configure mode: db or hybrid.');
  }

  async createMessage(_params: MessageCreateParams): Promise<{ id: string }> {
    throw new Error('Write operations require a database. Configure mode: db or hybrid.');
  }

  async createKBArticle(_params: KBArticleCreateParams): Promise<{ id: string }> {
    throw new Error('Write operations require a database. Configure mode: db or hybrid.');
  }
}
