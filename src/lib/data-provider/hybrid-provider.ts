/**
 * HybridProvider — reads from local DB, writes to local DB + sync_outbox.
 *
 * Every write operation:
 *   1. Delegates to DbProvider (writes to local Postgres)
 *   2. Inserts an outbox record (entity type, operation, serialized payload)
 *
 * The outbox is consumed by `cliaas sync push` / MCP `sync_push` which
 * sends pending changes to the hosted API and marks them as pushed.
 */

import { eq } from 'drizzle-orm';
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
} from './types';
import { DbProvider } from './db-provider';

// ---- Outbox helpers (lazy-loaded to avoid hard dep on schema at import time) ----

type OutboxOperation = 'create' | 'update';
type OutboxEntityType = 'ticket' | 'message' | 'kb_article' | 'survey_response';

interface OutboxEntry {
  id: string;
  workspaceId: string;
  operation: OutboxOperation;
  entityType: OutboxEntityType;
  entityId: string;
  payload: unknown;
  status: string;
  createdAt: Date;
  pushedAt: Date | null;
  error: string | null;
}

let _outboxReady: Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  schema: typeof import('@/db/schema');
  workspaceId: string;
} | null> | null = null;

async function getOutboxContext() {
  if (!_outboxReady) {
    _outboxReady = (async () => {
      if (!process.env.DATABASE_URL) return null;
      try {
        const [{ db }, schema] = await Promise.all([
          import('@/db'),
          import('@/db/schema'),
        ]);

        // Get workspace ID
        const workspaceName = process.env.CLIAAS_WORKSPACE;
        let workspaceId: string | null = null;

        if (workspaceName) {
          const byName = await db
            .select({ id: schema.workspaces.id })
            .from(schema.workspaces)
            .where(eq(schema.workspaces.name, workspaceName))
            .limit(1);
          if (byName[0]) workspaceId = byName[0].id;
        }

        if (!workspaceId) {
          const rows = await db
            .select({ id: schema.workspaces.id })
            .from(schema.workspaces)
            .orderBy(schema.workspaces.createdAt)
            .limit(1);
          workspaceId = rows[0]?.id ?? null;
        }

        if (!workspaceId) return null;
        return { db, schema, workspaceId };
      } catch {
        _outboxReady = null;
        return null;
      }
    })();
  }
  return _outboxReady;
}

async function insertOutboxEntry(
  operation: OutboxOperation,
  entityType: OutboxEntityType,
  entityId: string,
  payload: unknown,
): Promise<void> {
  const ctx = await getOutboxContext();
  if (!ctx) return; // No DB — silently skip outbox (graceful degradation)

  const { db, schema, workspaceId } = ctx;
  try {
    await db.insert(schema.syncOutbox).values({
      workspaceId,
      operation,
      entityType,
      entityId,
      payload,
      status: 'pending_push',
    });
  } catch (err) {
    // Surface outbox failures instead of silently losing sync records.
    // This prevents data divergence between local and hosted.
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Outbox insert failed for ${entityType}/${entityId}: ${msg}. Local change was committed but will NOT sync to hosted.`);
  }
}

export class HybridProvider implements DataProvider {
  readonly capabilities: ProviderCapabilities = {
    mode: 'hybrid',
    supportsWrite: true,
    supportsSync: true,
    supportsRag: true,
  };

  private local = new DbProvider();

  // ---- Reads: delegate to local DB (fast / offline-capable) ----

  async loadTickets(): Promise<Ticket[]> {
    return this.local.loadTickets();
  }

  async loadMessages(ticketId?: string): Promise<Message[]> {
    return this.local.loadMessages(ticketId);
  }

  async loadKBArticles(): Promise<KBArticle[]> {
    return this.local.loadKBArticles();
  }

  async loadCustomers(): Promise<Customer[]> {
    return this.local.loadCustomers();
  }

  async loadOrganizations(): Promise<Organization[]> {
    return this.local.loadOrganizations();
  }

  async loadRules(): Promise<RuleRecord[]> {
    return this.local.loadRules();
  }

  async loadCSATRatings(): Promise<CSATRating[]> {
    return this.local.loadCSATRatings();
  }

  async loadSurveyResponses(type?: SurveyType): Promise<SurveyResponse[]> {
    return this.local.loadSurveyResponses(type);
  }

  async loadSurveyConfigs(): Promise<SurveyConfig[]> {
    return this.local.loadSurveyConfigs();
  }

  async createSurveyResponse(params: SurveyResponseCreateParams): Promise<{ id: string }> {
    const result = await this.local.createSurveyResponse(params);
    await insertOutboxEntry('create', 'survey_response', result.id, params);
    return result;
  }

  async updateSurveyConfig(params: SurveyConfigUpdateParams): Promise<void> {
    return this.local.updateSurveyConfig(params);
  }

  // ---- Writes: local DB + outbox ----

  async createTicket(params: TicketCreateParams): Promise<{ id: string }> {
    const result = await this.local.createTicket(params);
    await insertOutboxEntry('create', 'ticket', result.id, params);
    return result;
  }

  async updateTicket(ticketId: string, params: TicketUpdateParams): Promise<void> {
    await this.local.updateTicket(ticketId, params);
    await insertOutboxEntry('update', 'ticket', ticketId, params);
  }

  async createMessage(params: MessageCreateParams): Promise<{ id: string }> {
    const result = await this.local.createMessage(params);
    await insertOutboxEntry('create', 'message', result.id, params);
    return result;
  }

  async createKBArticle(params: KBArticleCreateParams): Promise<{ id: string }> {
    const result = await this.local.createKBArticle(params);
    await insertOutboxEntry('create', 'kb_article', result.id, params);
    return result;
  }
}

/** Reset the outbox context cache (for tests). */
export function resetOutboxContext(): void {
  _outboxReady = null;
}

export type { OutboxEntry, OutboxOperation, OutboxEntityType };
