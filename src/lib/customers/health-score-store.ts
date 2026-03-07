/**
 * Customer Health Score JSONL store.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { withRls } from '../store-helpers';

export interface CustomerHealthScore {
  id: string;
  workspaceId: string;
  customerId: string;
  overallScore: number;    // 0-100
  csatScore?: number;
  sentimentScore?: number;
  effortScore?: number;
  resolutionScore?: number;
  engagementScore?: number;
  trend: 'improving' | 'declining' | 'stable';
  previousScore?: number;
  signals: Record<string, unknown>;
  computedAt: string;
}

const FILE = 'customer-health-scores.jsonl';
const scores: CustomerHealthScore[] = [];
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const saved = readJsonlFile<CustomerHealthScore>(FILE);
  if (saved.length > 0) scores.push(...saved);
}

function persist(): void {
  writeJsonlFile(FILE, scores);
}

export function upsertHealthScore(
  input: Omit<CustomerHealthScore, 'id' | 'computedAt'>,
): CustomerHealthScore {
  ensureLoaded();
  const idx = scores.findIndex(
    s => s.workspaceId === input.workspaceId && s.customerId === input.customerId,
  );

  const score: CustomerHealthScore = {
    ...input,
    id: idx >= 0 ? scores[idx].id : `chs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    computedAt: new Date().toISOString(),
  };

  if (idx >= 0) {
    scores[idx] = score;
  } else {
    scores.push(score);
  }
  persist();
  return score;
}

export async function getHealthScore(workspaceId: string, customerId: string): Promise<CustomerHealthScore | null> {
  const { eq, and } = await import('drizzle-orm');
  const result = await withRls(workspaceId, async ({ db, schema }) => {
    const rows = await db.select().from(schema.customerHealthScores).where(
      and(eq(schema.customerHealthScores.workspaceId, workspaceId), eq(schema.customerHealthScores.customerId, customerId)),
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      customerId: r.customerId,
      overallScore: r.overallScore,
      csatScore: r.csatScore ?? undefined,
      sentimentScore: r.sentimentScore ?? undefined,
      effortScore: r.effortScore ?? undefined,
      resolutionScore: r.resolutionScore ?? undefined,
      engagementScore: r.engagementScore ?? undefined,
      trend: r.trend as 'improving' | 'declining' | 'stable',
      previousScore: r.previousScore ?? undefined,
      signals: (r.signals ?? {}) as Record<string, unknown>,
      computedAt: r.computedAt.toISOString(),
    } as CustomerHealthScore;
  });
  if (result !== null) return result;
  ensureLoaded();
  return scores.find(s => s.workspaceId === workspaceId && s.customerId === customerId) ?? null;
}

export async function getHealthScores(filters?: {
  workspaceId?: string;
  minScore?: number;
  maxScore?: number;
  trend?: string;
}): Promise<CustomerHealthScore[]> {
  if (filters?.workspaceId) {
    const result = await withRls(filters.workspaceId, async ({ db, schema }) => {
      const rows = await db.select().from(schema.customerHealthScores);
      return rows.map(r => ({
        id: r.id,
        workspaceId: r.workspaceId,
        customerId: r.customerId,
        overallScore: r.overallScore,
        csatScore: r.csatScore ?? undefined,
        sentimentScore: r.sentimentScore ?? undefined,
        effortScore: r.effortScore ?? undefined,
        resolutionScore: r.resolutionScore ?? undefined,
        engagementScore: r.engagementScore ?? undefined,
        trend: r.trend as 'improving' | 'declining' | 'stable',
        previousScore: r.previousScore ?? undefined,
        signals: (r.signals ?? {}) as Record<string, unknown>,
        computedAt: r.computedAt.toISOString(),
      } as CustomerHealthScore));
    });
    if (result !== null) {
      let filtered = result;
      if (filters?.minScore !== undefined) filtered = filtered.filter(s => s.overallScore >= filters.minScore!);
      if (filters?.maxScore !== undefined) filtered = filtered.filter(s => s.overallScore <= filters.maxScore!);
      if (filters?.trend) filtered = filtered.filter(s => s.trend === filters.trend);
      return filtered.sort((a, b) => a.overallScore - b.overallScore);
    }
  }
  ensureLoaded();
  let result = [...scores];
  if (filters?.workspaceId) result = result.filter(s => s.workspaceId === filters.workspaceId);
  if (filters?.minScore !== undefined) result = result.filter(s => s.overallScore >= filters.minScore!);
  if (filters?.maxScore !== undefined) result = result.filter(s => s.overallScore <= filters.maxScore!);
  if (filters?.trend) result = result.filter(s => s.trend === filters.trend);
  return result.sort((a, b) => a.overallScore - b.overallScore);
}

export async function getAtRiskCustomers(workspaceId?: string, limit = 20): Promise<CustomerHealthScore[]> {
  const all = await getHealthScores({
    workspaceId,
    maxScore: 40,
  });
  return all.slice(0, limit);
}
