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

export function getHealthScore(workspaceId: string, customerId: string): CustomerHealthScore | null {
  ensureLoaded();
  return scores.find(s => s.workspaceId === workspaceId && s.customerId === customerId) ?? null;
}

export function getHealthScores(filters?: {
  workspaceId?: string;
  minScore?: number;
  maxScore?: number;
  trend?: string;
}): CustomerHealthScore[] {
  ensureLoaded();
  let result = [...scores];
  if (filters?.workspaceId) result = result.filter(s => s.workspaceId === filters.workspaceId);
  if (filters?.minScore !== undefined) result = result.filter(s => s.overallScore >= filters.minScore!);
  if (filters?.maxScore !== undefined) result = result.filter(s => s.overallScore <= filters.maxScore!);
  if (filters?.trend) result = result.filter(s => s.trend === filters.trend);
  return result.sort((a, b) => a.overallScore - b.overallScore);
}

export function getAtRiskCustomers(workspaceId?: string, limit = 20): CustomerHealthScore[] {
  return getHealthScores({
    workspaceId,
    maxScore: 40,
  }).slice(0, limit);
}
