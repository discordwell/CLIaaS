/**
 * AI Admin Controls — channel policy, circuit breaker, audit trail, usage reporting.
 * Productizes the AI resolution pipeline for enterprise admin visibility.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
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
