/**
 * AI Resolution persistence store.
 * Dual mode: DB primary, in-memory fallback for JSONL/demo.
 */

import { withRls } from '@/lib/store-helpers';

export interface AIResolutionRecord {
  id: string;
  workspaceId: string;
  ticketId: string;
  confidence: number;
  suggestedReply: string;
  reasoning?: string;
  kbArticlesUsed: string[];
  status: 'pending' | 'auto_resolved' | 'approved' | 'rejected' | 'edited' | 'escalated' | 'error';
  finalReply?: string;
  actionsTaken?: Record<string, unknown>;
  escalationReason?: string;
  errorMessage?: string;
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  costCents?: number;
  latencyMs?: number;
  reviewedBy?: string;
  reviewedAt?: string;
  csatScore?: number;
  csatComment?: string;
  createdAt: string;
}

export interface AIAgentConfigRecord {
  id: string;
  tenantId?: string;
  workspaceId: string;
  enabled: boolean;
  mode: 'suggest' | 'approve' | 'auto';
  confidenceThreshold: number;
  provider: string;
  model?: string;
  maxTokens: number;
  excludedTopics: string[];
  kbContext: boolean;
  piiDetection: boolean;
  maxAutoResolvesPerHour: number;
  requireKbCitation: boolean;
  channels: string[];
}

// ---- In-memory fallback ----

declare global {
  // eslint-disable-next-line no-var
  var __cliaasAIResolutions: AIResolutionRecord[] | undefined;
  // eslint-disable-next-line no-var
  var __cliaasAIAgentConfig: AIAgentConfigRecord | undefined;
}

function getInMemoryResolutions(): AIResolutionRecord[] {
  return global.__cliaasAIResolutions ?? [];
}

function setInMemoryResolutions(records: AIResolutionRecord[]): void {
  global.__cliaasAIResolutions = records;
}

// ---- DB helpers ----

async function tryDb() {
  try {
    const { getDb } = await import('@/db');
    const db = getDb();
    if (!db) return null;
    const schema = await import('@/db/schema');
    if (!schema.aiResolutions) return null;
    return { db, schema };
  } catch {
    return null;
  }
}

// ---- Resolution CRUD ----

export async function saveResolution(record: AIResolutionRecord): Promise<AIResolutionRecord> {
  const conn = await tryDb();
  if (conn) {
    try {
      const [row] = await conn.db.insert(conn.schema.aiResolutions).values({
        id: record.id,
        workspaceId: record.workspaceId,
        ticketId: record.ticketId,
        confidence: record.confidence,
        suggestedReply: record.suggestedReply,
        reasoning: record.reasoning ?? null,
        kbArticlesUsed: record.kbArticlesUsed,
        status: record.status,
        finalReply: record.finalReply ?? null,
        actionsTaken: record.actionsTaken ?? null,
        escalationReason: record.escalationReason ?? null,
        errorMessage: record.errorMessage ?? null,
        provider: record.provider ?? null,
        model: record.model ?? null,
        promptTokens: record.promptTokens ?? null,
        completionTokens: record.completionTokens ?? null,
        costCents: record.costCents ?? null,
        latencyMs: record.latencyMs ?? null,
        reviewedBy: record.reviewedBy ?? null,
        reviewedAt: record.reviewedAt ?? null,
        createdAt: new Date(record.createdAt),
      }).returning();
      return dbRowToRecord(row);
    } catch {
      // Fall through to in-memory
    }
  }

  // In-memory fallback — clone to avoid external mutation
  const clone = { ...record };
  const resolutions = getInMemoryResolutions();
  resolutions.unshift(clone);
  if (resolutions.length > 500) resolutions.length = 500;
  setInMemoryResolutions(resolutions);
  return clone;
}

export async function getResolution(id: string): Promise<AIResolutionRecord | null> {
  const conn = await tryDb();
  if (conn) {
    try {
      const { eq } = await import('drizzle-orm');
      const [row] = await conn.db.select().from(conn.schema.aiResolutions)
        .where(eq(conn.schema.aiResolutions.id, id)).limit(1);
      return row ? dbRowToRecord(row) : null;
    } catch {
      // Fall through
    }
  }

  return getInMemoryResolutions().find(r => r.id === id) ?? null;
}

export async function listResolutions(opts?: {
  workspaceId?: string;
  status?: string;
  ticketId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ records: AIResolutionRecord[]; total: number }> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const conn = await tryDb();
  if (conn) {
    try {
      const { eq, and, desc, count } = await import('drizzle-orm');
      const conditions = [];
      if (opts?.workspaceId) conditions.push(eq(conn.schema.aiResolutions.workspaceId, opts.workspaceId));
      if (opts?.status) conditions.push(eq(conn.schema.aiResolutions.status, opts.status as AIResolutionRecord['status']));
      if (opts?.ticketId) conditions.push(eq(conn.schema.aiResolutions.ticketId, opts.ticketId));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [countResult] = await conn.db.select({ count: count() }).from(conn.schema.aiResolutions).where(where);
      const rows = await conn.db.select().from(conn.schema.aiResolutions)
        .where(where)
        .orderBy(desc(conn.schema.aiResolutions.createdAt))
        .limit(limit).offset(offset);

      return { records: rows.map(dbRowToRecord), total: Number(countResult?.count ?? 0) };
    } catch {
      // Fall through
    }
  }

  // In-memory
  let records = getInMemoryResolutions();
  if (opts?.workspaceId) records = records.filter(r => r.workspaceId === opts.workspaceId);
  if (opts?.status) records = records.filter(r => r.status === opts.status);
  if (opts?.ticketId) records = records.filter(r => r.ticketId === opts.ticketId);
  const total = records.length;
  return { records: records.slice(offset, offset + limit), total };
}

export async function updateResolutionStatus(
  id: string,
  status: AIResolutionRecord['status'],
  extra?: Partial<Pick<AIResolutionRecord, 'finalReply' | 'reviewedBy' | 'reviewedAt' | 'errorMessage' | 'csatScore' | 'csatComment'>>,
): Promise<AIResolutionRecord | null> {
  const conn = await tryDb();
  if (conn) {
    try {
      const { eq } = await import('drizzle-orm');
      const set: Record<string, unknown> = { status };
      if (extra?.finalReply !== undefined) set.finalReply = extra.finalReply;
      if (extra?.reviewedBy !== undefined) set.reviewedBy = extra.reviewedBy;
      if (extra?.reviewedAt !== undefined) set.reviewedAt = new Date(extra.reviewedAt);
      if (extra?.errorMessage !== undefined) set.errorMessage = extra.errorMessage;
      if (extra?.csatScore !== undefined) set.csatScore = extra.csatScore;
      if (extra?.csatComment !== undefined) set.csatComment = extra.csatComment;

      const [row] = await conn.db.update(conn.schema.aiResolutions)
        .set(set).where(eq(conn.schema.aiResolutions.id, id)).returning();
      return row ? dbRowToRecord(row) : null;
    } catch {
      // Fall through
    }
  }

  // In-memory
  const records = getInMemoryResolutions();
  const record = records.find(r => r.id === id);
  if (!record) return null;
  record.status = status;
  if (extra) Object.assign(record, extra);
  return record;
}

// ---- Agent Config ----

const DEFAULT_CONFIG: Omit<AIAgentConfigRecord, 'id' | 'workspaceId'> = {
  enabled: false,
  mode: 'suggest',
  confidenceThreshold: 0.7,
  provider: 'claude',
  maxTokens: 1024,
  excludedTopics: ['billing', 'legal', 'security'],
  kbContext: true,
  piiDetection: true,
  maxAutoResolvesPerHour: 50,
  requireKbCitation: false,
  channels: [],
};

export async function getAgentConfig(workspaceId: string): Promise<AIAgentConfigRecord> {
  const conn = await tryDb();
  if (conn) {
    try {
      const { eq } = await import('drizzle-orm');
      const [row] = await conn.db.select().from(conn.schema.aiAgentConfigs)
        .where(eq(conn.schema.aiAgentConfigs.workspaceId, workspaceId)).limit(1);
      if (row) return dbConfigToRecord(row);
    } catch {
      // Fall through
    }
  }

  // In-memory / default
  if (global.__cliaasAIAgentConfig?.workspaceId === workspaceId) {
    return global.__cliaasAIAgentConfig;
  }
  return { id: crypto.randomUUID(), workspaceId, ...DEFAULT_CONFIG };
}

export async function saveAgentConfig(config: Partial<AIAgentConfigRecord> & { workspaceId: string }): Promise<AIAgentConfigRecord> {
  const existing = await getAgentConfig(config.workspaceId);
  const merged = { ...existing, ...config };

  const conn = await tryDb();
  if (conn) {
    try {
      const { eq } = await import('drizzle-orm');
      // Try update first
      const [updated] = await conn.db.update(conn.schema.aiAgentConfigs)
        .set({
          enabled: merged.enabled,
          mode: merged.mode,
          confidenceThreshold: merged.confidenceThreshold,
          provider: merged.provider,
          model: merged.model ?? null,
          maxTokens: merged.maxTokens,
          excludedTopics: merged.excludedTopics,
          kbContext: merged.kbContext,
          piiDetection: merged.piiDetection,
          maxAutoResolvesPerHour: merged.maxAutoResolvesPerHour,
          requireKbCitation: merged.requireKbCitation,
          channels: merged.channels,
          updatedAt: new Date(),
        })
        .where(eq(conn.schema.aiAgentConfigs.workspaceId, config.workspaceId))
        .returning();

      if (updated) return dbConfigToRecord(updated);

      // Insert if not found
      const [inserted] = await conn.db.insert(conn.schema.aiAgentConfigs).values({
        workspaceId: merged.workspaceId,
        tenantId: merged.tenantId ?? null,
        enabled: merged.enabled,
        mode: merged.mode,
        confidenceThreshold: merged.confidenceThreshold,
        provider: merged.provider,
        model: merged.model ?? null,
        maxTokens: merged.maxTokens,
        excludedTopics: merged.excludedTopics,
        kbContext: merged.kbContext,
        piiDetection: merged.piiDetection,
        maxAutoResolvesPerHour: merged.maxAutoResolvesPerHour,
        requireKbCitation: merged.requireKbCitation,
        channels: merged.channels,
      }).returning();
      return dbConfigToRecord(inserted);
    } catch {
      // Fall through
    }
  }

  // In-memory
  global.__cliaasAIAgentConfig = merged;
  return merged;
}

// ---- Stats ----

export async function getResolutionStats(workspaceId?: string, dateRange?: { from: string; to: string }) {
  const conn = await tryDb();
  if (conn) {
    try {
      const { eq, and, gte, lte, count, avg, sql } = await import('drizzle-orm');
      const conditions = [];
      if (workspaceId) conditions.push(eq(conn.schema.aiResolutions.workspaceId, workspaceId));
      if (dateRange?.from) conditions.push(gte(conn.schema.aiResolutions.createdAt, new Date(dateRange.from)));
      if (dateRange?.to) conditions.push(lte(conn.schema.aiResolutions.createdAt, new Date(dateRange.to)));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [stats] = await conn.db.select({
        total: count(),
        avgConfidence: avg(conn.schema.aiResolutions.confidence),
        avgLatency: avg(conn.schema.aiResolutions.latencyMs),
        totalCost: sql<string>`COALESCE(SUM(${conn.schema.aiResolutions.costCents}), 0)`,
      }).from(conn.schema.aiResolutions).where(where);

      // Count by status
      const statusCounts = await conn.db.select({
        status: conn.schema.aiResolutions.status,
        count: count(),
      }).from(conn.schema.aiResolutions).where(where).groupBy(conn.schema.aiResolutions.status);

      const byStatus: Record<string, number> = {};
      for (const row of statusCounts) {
        byStatus[row.status] = Number(row.count);
      }

      const total = Number(stats?.total ?? 0);
      const aiResolved = (byStatus['auto_resolved'] ?? 0) + (byStatus['approved'] ?? 0);

      return {
        totalResolutions: total,
        aiResolved,
        escalated: byStatus['escalated'] ?? 0,
        pending: byStatus['pending'] ?? 0,
        rejected: byStatus['rejected'] ?? 0,
        errors: byStatus['error'] ?? 0,
        avgConfidence: stats?.avgConfidence ? Math.round(Number(stats.avgConfidence) * 100) / 100 : 0,
        avgLatencyMs: stats?.avgLatency ? Math.round(Number(stats.avgLatency)) : 0,
        totalCostCents: Math.round(Number(stats?.totalCost ?? 0) * 100) / 100,
        estimatedTimeSavedMinutes: aiResolved * 8,
        resolutionRate: total > 0 ? Math.round((aiResolved / total) * 100) : 0,
      };
    } catch {
      // Fall through
    }
  }

  // In-memory stats
  let records = getInMemoryResolutions();
  if (workspaceId) records = records.filter(r => r.workspaceId === workspaceId);
  if (dateRange?.from) records = records.filter(r => r.createdAt >= dateRange.from);
  if (dateRange?.to) records = records.filter(r => r.createdAt <= dateRange.to);

  const total = records.length;
  const aiResolved = records.filter(r => r.status === 'auto_resolved' || r.status === 'approved').length;
  const avgConf = total > 0 ? records.reduce((sum, r) => sum + r.confidence, 0) / total : 0;

  return {
    totalResolutions: total,
    aiResolved,
    escalated: records.filter(r => r.status === 'escalated').length,
    pending: records.filter(r => r.status === 'pending').length,
    rejected: records.filter(r => r.status === 'rejected').length,
    errors: records.filter(r => r.status === 'error').length,
    avgConfidence: Math.round(avgConf * 100) / 100,
    avgLatencyMs: 0,
    totalCostCents: 0,
    estimatedTimeSavedMinutes: aiResolved * 8,
    resolutionRate: total > 0 ? Math.round((aiResolved / total) * 100) : 0,
  };
}

// ---- DB row mappers ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbRowToRecord(row: any): AIResolutionRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ticketId: row.ticketId,
    confidence: Number(row.confidence),
    suggestedReply: row.suggestedReply,
    reasoning: row.reasoning ?? undefined,
    kbArticlesUsed: row.kbArticlesUsed ?? [],
    status: row.status,
    finalReply: row.finalReply ?? undefined,
    actionsTaken: row.actionsTaken ?? undefined,
    escalationReason: row.escalationReason ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    promptTokens: row.promptTokens ?? undefined,
    completionTokens: row.completionTokens ?? undefined,
    costCents: row.costCents != null ? Number(row.costCents) : undefined,
    latencyMs: row.latencyMs ?? undefined,
    reviewedBy: row.reviewedBy ?? undefined,
    reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString() : undefined,
    csatScore: row.csatScore ?? undefined,
    csatComment: row.csatComment ?? undefined,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbConfigToRecord(row: any): AIAgentConfigRecord {
  return {
    id: row.id,
    tenantId: row.tenantId ?? undefined,
    workspaceId: row.workspaceId,
    enabled: row.enabled,
    mode: row.mode,
    confidenceThreshold: Number(row.confidenceThreshold),
    provider: row.provider,
    model: row.model ?? undefined,
    maxTokens: row.maxTokens,
    excludedTopics: row.excludedTopics ?? [],
    kbContext: row.kbContext,
    piiDetection: row.piiDetection,
    maxAutoResolvesPerHour: row.maxAutoResolvesPerHour,
    requireKbCitation: row.requireKbCitation,
    channels: row.channels ?? [],
  };
}
