/**
 * AI Admin Controls — channel policy, circuit breaker, audit trail, usage reporting.
 * Productizes the AI resolution pipeline for enterprise admin visibility.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { withRls } from '../store-helpers';
import { createLogger } from '../logger';

const logger = createLogger('ai:admin-controls');

// ---- Channel Policy ----

export interface ChannelPolicy {
  channel: string; // 'email' | 'chat' | 'voice' | 'social' | 'api' | '*'
  enabled: boolean;
  mode: 'suggest' | 'approve' | 'auto';
  maxAutoResolvesPerHour: number;
  confidenceThreshold: number;
  excludedTopics: string[];
}

const CHANNEL_POLICIES_FILE = 'ai-channel-policies.jsonl';

declare global {
  // eslint-disable-next-line no-var
  var __cliaasAIChannelPolicies: ChannelPolicy[] | undefined;
}

function loadChannelPolicies(): ChannelPolicy[] {
  if (!global.__cliaasAIChannelPolicies) {
    global.__cliaasAIChannelPolicies = readJsonlFile<ChannelPolicy>(CHANNEL_POLICIES_FILE);
  }
  return global.__cliaasAIChannelPolicies;
}

export function getChannelPolicies(): ChannelPolicy[] {
  return [...loadChannelPolicies()];
}

export function getChannelPolicy(channel: string): ChannelPolicy | undefined {
  const policies = loadChannelPolicies();
  return policies.find(p => p.channel === channel) ?? policies.find(p => p.channel === '*');
}

export function setChannelPolicy(policy: ChannelPolicy): ChannelPolicy {
  const policies = loadChannelPolicies();
  const idx = policies.findIndex(p => p.channel === policy.channel);
  if (idx >= 0) {
    policies[idx] = policy;
  } else {
    policies.push(policy);
  }
  writeJsonlFile(CHANNEL_POLICIES_FILE, policies);
  return policy;
}

export function isChannelAllowed(channel: string): boolean {
  const policy = getChannelPolicy(channel);
  if (!policy) return true; // No policy = allowed (fail open)
  return policy.enabled;
}

// ---- Circuit Breaker ----

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half_open';
  failureCount: number;
  lastFailureAt?: string;
  lastSuccessAt?: string;
  openedAt?: string;
  halfOpenAttempts: number;
}

const CIRCUIT_BREAKER_FILE = 'ai-circuit-breaker.jsonl';
const FAILURE_THRESHOLD = 5;
const RECOVERY_TIMEOUT_MS = 60_000; // 1 minute

declare global {
  // eslint-disable-next-line no-var
  var __cliaasAICircuitBreaker: CircuitBreakerState | undefined;
}

function getCircuitState(): CircuitBreakerState {
  if (!global.__cliaasAICircuitBreaker) {
    const saved = readJsonlFile<CircuitBreakerState>(CIRCUIT_BREAKER_FILE);
    global.__cliaasAICircuitBreaker = saved[0] ?? {
      state: 'closed',
      failureCount: 0,
      halfOpenAttempts: 0,
    };
  }
  return global.__cliaasAICircuitBreaker;
}

function persistCircuitState(): void {
  const state = getCircuitState();
  writeJsonlFile(CIRCUIT_BREAKER_FILE, [state]);
}

export function getCircuitBreakerStatus(): CircuitBreakerState {
  const state = getCircuitState();

  // Auto-transition from open to half_open after recovery timeout
  if (state.state === 'open' && state.openedAt) {
    const elapsed = Date.now() - new Date(state.openedAt).getTime();
    if (elapsed >= RECOVERY_TIMEOUT_MS) {
      state.state = 'half_open';
      state.halfOpenAttempts = 0;
      persistCircuitState();
    }
  }

  return { ...state };
}

export function shouldAllowAIRequest(): boolean {
  const state = getCircuitBreakerStatus();
  if (state.state === 'closed') return true;
  if (state.state === 'half_open') return state.halfOpenAttempts < 3;
  return false; // open
}

export function recordAISuccess(): void {
  const state = getCircuitState();
  state.lastSuccessAt = new Date().toISOString();

  if (state.state === 'half_open') {
    // Recovery confirmed
    state.state = 'closed';
    state.failureCount = 0;
    state.halfOpenAttempts = 0;
    logger.info('AI circuit breaker: recovered (closed)');
  } else {
    state.failureCount = Math.max(0, state.failureCount - 1);
  }
  persistCircuitState();
}

export function recordAIFailure(error: string): void {
  const state = getCircuitState();
  state.failureCount++;
  state.lastFailureAt = new Date().toISOString();

  if (state.state === 'half_open') {
    state.halfOpenAttempts++;
    if (state.halfOpenAttempts >= 3) {
      state.state = 'open';
      state.openedAt = new Date().toISOString();
      logger.warn({ error }, 'AI circuit breaker: re-opened after half_open failures');
    }
  } else if (state.failureCount >= FAILURE_THRESHOLD) {
    state.state = 'open';
    state.openedAt = new Date().toISOString();
    logger.warn({ failureCount: state.failureCount, error }, 'AI circuit breaker: opened');
  }
  persistCircuitState();
}

export function resetCircuitBreaker(): void {
  global.__cliaasAICircuitBreaker = {
    state: 'closed',
    failureCount: 0,
    halfOpenAttempts: 0,
  };
  persistCircuitState();
}

// ---- Audit Trail ----

export interface AIAuditEntry {
  id: string;
  timestamp: string;
  workspaceId: string;
  action: 'resolution_created' | 'resolution_approved' | 'resolution_rejected'
    | 'resolution_auto_sent' | 'resolution_escalated' | 'resolution_error'
    | 'config_changed' | 'circuit_breaker_opened' | 'circuit_breaker_reset'
    | 'channel_policy_changed';
  ticketId?: string;
  resolutionId?: string;
  userId?: string;
  details: Record<string, unknown>;
}

const AUDIT_FILE = 'ai-audit-trail.jsonl';

export function recordAuditEntry(entry: Omit<AIAuditEntry, 'id' | 'timestamp'>): AIAuditEntry {
  const full: AIAuditEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };

  const existing = readJsonlFile<AIAuditEntry>(AUDIT_FILE);
  existing.push(full);
  // Keep last 10000 entries
  const trimmed = existing.slice(-10000);
  writeJsonlFile(AUDIT_FILE, trimmed);

  return full;
}

export function getAuditTrail(opts?: {
  workspaceId?: string;
  action?: string;
  ticketId?: string;
  limit?: number;
  offset?: number;
}): { entries: AIAuditEntry[]; total: number } {
  let entries = readJsonlFile<AIAuditEntry>(AUDIT_FILE);
  if (opts?.workspaceId) entries = entries.filter(e => e.workspaceId === opts.workspaceId);
  if (opts?.action) entries = entries.filter(e => e.action === opts.action);
  if (opts?.ticketId) entries = entries.filter(e => e.ticketId === opts.ticketId);

  const total = entries.length;
  const offset = opts?.offset ?? 0;
  const limit = opts?.limit ?? 50;
  return { entries: entries.slice(offset, offset + limit), total };
}

// ---- Usage Reporting ----

export interface AIUsageSnapshot {
  workspaceId: string;
  period: string; // ISO date (hourly bucket)
  totalRequests: number;
  autoResolved: number;
  escalated: number;
  errors: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCostCents: number;
  avgLatencyMs: number;
  avgConfidence: number;
}

const USAGE_FILE = 'ai-usage-snapshots.jsonl';

export function recordUsageSnapshot(snapshot: AIUsageSnapshot): void {
  const existing = readJsonlFile<AIUsageSnapshot>(USAGE_FILE);
  // Merge if same workspace + period
  const idx = existing.findIndex(
    s => s.workspaceId === snapshot.workspaceId && s.period === snapshot.period,
  );
  if (idx >= 0) {
    const prev = existing[idx];
    existing[idx] = {
      ...prev,
      totalRequests: prev.totalRequests + snapshot.totalRequests,
      autoResolved: prev.autoResolved + snapshot.autoResolved,
      escalated: prev.escalated + snapshot.escalated,
      errors: prev.errors + snapshot.errors,
      totalTokens: prev.totalTokens + snapshot.totalTokens,
      promptTokens: prev.promptTokens + snapshot.promptTokens,
      completionTokens: prev.completionTokens + snapshot.completionTokens,
      totalCostCents: prev.totalCostCents + snapshot.totalCostCents,
      avgLatencyMs: Math.round((prev.avgLatencyMs + snapshot.avgLatencyMs) / 2),
      avgConfidence: Math.round(((prev.avgConfidence + snapshot.avgConfidence) / 2) * 100) / 100,
    };
  } else {
    existing.push(snapshot);
  }
  // Keep last 720 snapshots (30 days hourly)
  writeJsonlFile(USAGE_FILE, existing.slice(-720));
}

export function getUsageReport(workspaceId: string, opts?: {
  from?: string;
  to?: string;
}): AIUsageSnapshot[] {
  let snapshots = readJsonlFile<AIUsageSnapshot>(USAGE_FILE);
  snapshots = snapshots.filter(s => s.workspaceId === workspaceId);
  if (opts?.from) snapshots = snapshots.filter(s => s.period >= opts.from!);
  if (opts?.to) snapshots = snapshots.filter(s => s.period <= opts.to!);
  return snapshots;
}

export function getUsageSummary(workspaceId: string, opts?: {
  from?: string;
  to?: string;
}): {
  totalRequests: number;
  autoResolved: number;
  escalated: number;
  errors: number;
  totalTokens: number;
  totalCostCents: number;
  avgLatencyMs: number;
  avgConfidence: number;
  resolutionRate: number;
} {
  const snapshots = getUsageReport(workspaceId, opts);
  if (snapshots.length === 0) {
    return {
      totalRequests: 0, autoResolved: 0, escalated: 0, errors: 0,
      totalTokens: 0, totalCostCents: 0, avgLatencyMs: 0, avgConfidence: 0,
      resolutionRate: 0,
    };
  }

  const totals = snapshots.reduce((acc, s) => ({
    totalRequests: acc.totalRequests + s.totalRequests,
    autoResolved: acc.autoResolved + s.autoResolved,
    escalated: acc.escalated + s.escalated,
    errors: acc.errors + s.errors,
    totalTokens: acc.totalTokens + s.totalTokens,
    totalCostCents: acc.totalCostCents + s.totalCostCents,
    latencySum: acc.latencySum + s.avgLatencyMs * s.totalRequests,
    confidenceSum: acc.confidenceSum + s.avgConfidence * s.totalRequests,
  }), { totalRequests: 0, autoResolved: 0, escalated: 0, errors: 0, totalTokens: 0, totalCostCents: 0, latencySum: 0, confidenceSum: 0 });

  return {
    totalRequests: totals.totalRequests,
    autoResolved: totals.autoResolved,
    escalated: totals.escalated,
    errors: totals.errors,
    totalTokens: totals.totalTokens,
    totalCostCents: Math.round(totals.totalCostCents * 100) / 100,
    avgLatencyMs: totals.totalRequests > 0 ? Math.round(totals.latencySum / totals.totalRequests) : 0,
    avgConfidence: totals.totalRequests > 0 ? Math.round((totals.confidenceSum / totals.totalRequests) * 100) / 100 : 0,
    resolutionRate: totals.totalRequests > 0 ? Math.round((totals.autoResolved / totals.totalRequests) * 100) : 0,
  };
}

// ---- Async DB-first variants (JSONL fallback) ----

export async function getChannelPoliciesAsync(workspaceId: string): Promise<ChannelPolicy[]> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const rows = await db.select().from(schema.aiChannelPolicies);
    return rows.map(r => ({
      channel: r.channel,
      enabled: r.enabled,
      mode: r.mode as ChannelPolicy['mode'],
      maxAutoResolvesPerHour: r.maxAutoResolvesPerHour,
      confidenceThreshold: Number(r.confidenceThreshold),
      excludedTopics: (r.excludedTopics as string[]) ?? [],
    }));
  });
  return dbResult ?? getChannelPolicies();
}

export async function setChannelPolicyAsync(policy: ChannelPolicy, workspaceId: string): Promise<ChannelPolicy> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const { sql } = await import('drizzle-orm');
    const now = new Date();
    await db.insert(schema.aiChannelPolicies).values({
      workspaceId,
      channel: policy.channel,
      enabled: policy.enabled,
      mode: policy.mode,
      maxAutoResolvesPerHour: policy.maxAutoResolvesPerHour,
      confidenceThreshold: String(policy.confidenceThreshold),
      excludedTopics: policy.excludedTopics,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.aiChannelPolicies.workspaceId, schema.aiChannelPolicies.channel],
      set: {
        enabled: sql`excluded.enabled`,
        mode: sql`excluded.mode`,
        maxAutoResolvesPerHour: sql`excluded.max_auto_resolves_per_hour`,
        confidenceThreshold: sql`excluded.confidence_threshold`,
        excludedTopics: sql`excluded.excluded_topics`,
        updatedAt: now,
      },
    });
    return policy;
  });
  return dbResult ?? setChannelPolicy(policy);
}

export async function getCircuitBreakerStatusAsync(workspaceId: string): Promise<CircuitBreakerState> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const [row] = await db.select().from(schema.aiCircuitBreaker).limit(1);
    if (!row) return { state: 'closed' as const, failureCount: 0, halfOpenAttempts: 0 };
    const state: CircuitBreakerState = {
      state: row.state as CircuitBreakerState['state'],
      failureCount: row.failureCount,
      halfOpenAttempts: row.halfOpenAttempts,
      lastFailureAt: row.lastFailureAt?.toISOString(),
      lastSuccessAt: row.lastSuccessAt?.toISOString(),
      openedAt: row.openedAt?.toISOString(),
    };
    // Auto-transition from open to half_open
    if (state.state === 'open' && state.openedAt) {
      const elapsed = Date.now() - new Date(state.openedAt).getTime();
      if (elapsed >= RECOVERY_TIMEOUT_MS) {
        const { eq } = await import('drizzle-orm');
        await db.update(schema.aiCircuitBreaker)
          .set({ state: 'half_open', halfOpenAttempts: 0, updatedAt: new Date() })
          .where(eq(schema.aiCircuitBreaker.workspaceId, workspaceId));
        state.state = 'half_open';
        state.halfOpenAttempts = 0;
      }
    }
    return state;
  });
  return dbResult ?? getCircuitBreakerStatus();
}

export async function recordAISuccessAsync(workspaceId: string): Promise<void> {
  const done = await withRls(workspaceId, async ({ db, schema }) => {
    const { eq, sql } = await import('drizzle-orm');
    const now = new Date();
    // Atomic update: decrement failure count, set lastSuccessAt
    const [row] = await db.select().from(schema.aiCircuitBreaker).limit(1);
    if (!row) return;
    if (row.state === 'half_open') {
      await db.update(schema.aiCircuitBreaker)
        .set({ state: 'closed', failureCount: 0, halfOpenAttempts: 0, lastSuccessAt: now, updatedAt: now })
        .where(eq(schema.aiCircuitBreaker.workspaceId, workspaceId));
    } else {
      await db.update(schema.aiCircuitBreaker)
        .set({
          failureCount: sql`GREATEST(failure_count - 1, 0)`,
          lastSuccessAt: now,
          updatedAt: now,
        })
        .where(eq(schema.aiCircuitBreaker.workspaceId, workspaceId));
    }
  });
  if (done === null) recordAISuccess();
}

export async function recordAIFailureAsync(error: string, workspaceId: string): Promise<void> {
  const done = await withRls(workspaceId, async ({ db, schema }) => {
    const { eq, sql } = await import('drizzle-orm');
    const now = new Date();
    // Upsert circuit breaker row
    await db.insert(schema.aiCircuitBreaker).values({
      workspaceId,
      state: 'closed',
      failureCount: 1,
      halfOpenAttempts: 0,
      lastFailureAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: schema.aiCircuitBreaker.workspaceId,
      set: {
        failureCount: sql`ai_circuit_breaker.failure_count + 1`,
        lastFailureAt: now,
        updatedAt: now,
      },
    });
    // Check if we need to open the circuit
    const [row] = await db.select().from(schema.aiCircuitBreaker)
      .where(eq(schema.aiCircuitBreaker.workspaceId, workspaceId));
    if (row) {
      if (row.state === 'half_open' && row.halfOpenAttempts >= 2) {
        await db.update(schema.aiCircuitBreaker)
          .set({ state: 'open', openedAt: now, updatedAt: now })
          .where(eq(schema.aiCircuitBreaker.workspaceId, workspaceId));
      } else if (row.state === 'closed' && row.failureCount >= FAILURE_THRESHOLD) {
        await db.update(schema.aiCircuitBreaker)
          .set({ state: 'open', openedAt: now, updatedAt: now })
          .where(eq(schema.aiCircuitBreaker.workspaceId, workspaceId));
      }
    }
  });
  if (done === null) recordAIFailure(error);
}

export async function appendAuditEntryAsync(
  entry: Omit<AIAuditEntry, 'id' | 'timestamp'>,
): Promise<AIAuditEntry> {
  const full: AIAuditEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  const dbResult = await withRls(entry.workspaceId, async ({ db, schema }) => {
    await db.insert(schema.aiAuditTrail).values({
      workspaceId: entry.workspaceId,
      action: entry.action,
      ticketId: entry.ticketId ?? null,
      resolutionId: entry.resolutionId ?? null,
      userId: entry.userId ?? null,
      details: entry.details,
    });
    return full;
  });
  return dbResult ?? recordAuditEntry(entry);
}

export async function getAuditTrailAsync(opts?: {
  workspaceId?: string;
  action?: string;
  ticketId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ entries: AIAuditEntry[]; total: number }> {
  if (!opts?.workspaceId) return getAuditTrail(opts);
  const dbResult = await withRls(opts.workspaceId, async ({ db, schema }) => {
    const { eq, and, count, desc } = await import('drizzle-orm');
    const conditions = [];
    if (opts.action) conditions.push(eq(schema.aiAuditTrail.action, opts.action));
    if (opts.ticketId) conditions.push(eq(schema.aiAuditTrail.ticketId, opts.ticketId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ value: total }] = await db.select({ value: count() }).from(schema.aiAuditTrail).where(where);
    const rows = await db.select().from(schema.aiAuditTrail)
      .where(where)
      .orderBy(desc(schema.aiAuditTrail.createdAt))
      .offset(opts.offset ?? 0)
      .limit(opts.limit ?? 50);

    return {
      total,
      entries: rows.map(r => ({
        id: r.id,
        timestamp: r.createdAt.toISOString(),
        workspaceId: r.workspaceId,
        action: r.action as AIAuditEntry['action'],
        ticketId: r.ticketId ?? undefined,
        resolutionId: r.resolutionId ?? undefined,
        userId: r.userId ?? undefined,
        details: (r.details as Record<string, unknown>) ?? {},
      })),
    };
  });
  return dbResult ?? getAuditTrail(opts);
}

export async function getUsageReportAsync(workspaceId: string, opts?: {
  from?: string;
  to?: string;
}): Promise<AIUsageSnapshot[]> {
  const dbResult = await withRls(workspaceId, async ({ db, schema }) => {
    const { and, gte, lte } = await import('drizzle-orm');
    const conditions = [];
    if (opts?.from) conditions.push(gte(schema.aiUsageSnapshots.period, opts.from));
    if (opts?.to) conditions.push(lte(schema.aiUsageSnapshots.period, opts.to));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db.select().from(schema.aiUsageSnapshots).where(where);
    return rows.map(r => ({
      workspaceId: r.workspaceId,
      period: r.period,
      totalRequests: r.totalRequests,
      autoResolved: r.autoResolved,
      escalated: r.escalated,
      errors: r.errors,
      totalTokens: r.totalTokens,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalCostCents: Number(r.totalCostCents),
      avgLatencyMs: r.avgLatencyMs,
      avgConfidence: Number(r.avgConfidence),
    }));
  });
  return dbResult ?? getUsageReport(workspaceId, opts);
}
