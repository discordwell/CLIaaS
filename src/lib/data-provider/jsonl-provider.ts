/**
 * JsonlProvider — reads JSONL export files. BYOC / demo backend.
 * Writes are not supported (throws).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
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
  SurveyType,
  SurveyResponse,
  SurveyConfig,
  SurveyResponseCreateParams,
  SurveyConfigUpdateParams,
  TicketCreateParams,
  TicketUpdateParams,
  MessageCreateParams,
  KBArticleCreateParams,
  TicketMergeParams,
  TicketMergeResult,
  TicketSplitParams,
  TicketSplitResult,
  TicketUnmergeParams,
  MergeHistoryEntry,
} from './types';

/** Auto-discover all export directories that contain a manifest.json. */
function discoverExportDirs(): string[] {
  const dirs: string[] = [];

  // Check the demo directory
  if (existsSync(join('/tmp/cliaas-demo', 'manifest.json'))) {
    dirs.push('/tmp/cliaas-demo');
  }

  // Scan ./exports/* for any connector subdirectory with a manifest
  const exportsRoot = './exports';
  if (existsSync(exportsRoot)) {
    try {
      for (const entry of readdirSync(exportsRoot)) {
        const subdir = join(exportsRoot, entry);
        try {
          if (statSync(subdir).isDirectory() && existsSync(join(subdir, 'manifest.json'))) {
            dirs.push(subdir);
          }
        } catch {
          // Skip unreadable entries
        }
      }
    } catch {
      // exports dir unreadable
    }
  }

  // Check ./exports itself (legacy flat layout)
  if (existsSync(join(exportsRoot, 'manifest.json'))) {
    dirs.push(exportsRoot);
  }

  return dirs;
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

function findAllExportDirs(overrideDir?: string): string[] {
  if (overrideDir) {
    return existsSync(join(overrideDir, 'manifest.json')) ? [overrideDir] : [];
  }
  return discoverExportDirs();
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

  async loadSurveyResponses(_type?: SurveyType): Promise<SurveyResponse[]> {
    return [];
  }

  async loadSurveyConfigs(): Promise<SurveyConfig[]> {
    return [];
  }

  async createSurveyResponse(_params: SurveyResponseCreateParams): Promise<{ id: string }> {
    throw new Error('Write operations require a database. Configure mode: db or hybrid.');
  }

  async updateSurveyConfig(_params: SurveyConfigUpdateParams): Promise<void> {
    throw new Error('Write operations require a database. Configure mode: db or hybrid.');
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

  async mergeTickets(_params: TicketMergeParams): Promise<TicketMergeResult> {
    throw new Error('Merge operations require a database. Configure mode: db or hybrid.');
  }

  async splitTicket(_params: TicketSplitParams): Promise<TicketSplitResult> {
    throw new Error('Split operations require a database. Configure mode: db or hybrid.');
  }

  async unmergeTicket(_params: TicketUnmergeParams): Promise<void> {
    throw new Error('Unmerge operations require a database. Configure mode: db or hybrid.');
  }

  async getMergeHistory(_ticketId: string): Promise<MergeHistoryEntry[]> {
    return [];
  }
}
