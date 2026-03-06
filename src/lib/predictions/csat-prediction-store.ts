/**
 * CSAT Prediction JSONL store.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { withRls } from '../store-helpers';

export interface CSATPrediction {
  id: string;
  workspaceId: string;
  ticketId: string;
  predictedScore: number; // 1.0 - 5.0
  confidence: number;     // 0.00 - 1.00
  riskLevel: 'low' | 'medium' | 'high';
  factors: Record<string, unknown>;
  predictedAt: string;
  actualScore?: number;
  actualReceivedAt?: string;
}

const FILE = 'csat-predictions.jsonl';
const predictions: CSATPrediction[] = [];
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const saved = readJsonlFile<CSATPrediction>(FILE);
  if (saved.length > 0) predictions.push(...saved);
}

function persist(): void {
  writeJsonlFile(FILE, predictions);
}

export function createPrediction(input: Omit<CSATPrediction, 'id' | 'predictedAt'>): CSATPrediction {
  ensureLoaded();
  const prediction: CSATPrediction = {
    ...input,
    id: `cpred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    predictedAt: new Date().toISOString(),
  };
  predictions.push(prediction);
  persist();
  return prediction;
}

export function getPredictions(filters?: {
  workspaceId?: string;
  ticketId?: string;
  riskLevel?: string;
}): CSATPrediction[] {
  ensureLoaded();
  let result = [...predictions];
  if (filters?.workspaceId) result = result.filter(p => p.workspaceId === filters.workspaceId);
  if (filters?.ticketId) result = result.filter(p => p.ticketId === filters.ticketId);
  if (filters?.riskLevel) result = result.filter(p => p.riskLevel === filters.riskLevel);
  return result.sort((a, b) => new Date(b.predictedAt).getTime() - new Date(a.predictedAt).getTime());
}

export function recordActualScore(ticketId: string, actualScore: number, workspaceId?: string): CSATPrediction | null {
  ensureLoaded();
  const idx = predictions.findIndex(p => p.ticketId === ticketId && !p.actualScore && (!workspaceId || p.workspaceId === workspaceId));
  if (idx === -1) return null;
  predictions[idx] = {
    ...predictions[idx],
    actualScore,
    actualReceivedAt: new Date().toISOString(),
  };
  persist();
  return predictions[idx];
}

export function getAccuracyStats(workspaceId?: string): {
  totalPredictions: number;
  withActual: number;
  avgError: number;
  avgConfidence: number;
  byRiskLevel: Record<string, { count: number; avgPredicted: number; avgActual: number }>;
} {
  ensureLoaded();
  let preds = [...predictions];
  if (workspaceId) preds = preds.filter(p => p.workspaceId === workspaceId);

  const withActual = preds.filter(p => p.actualScore !== undefined);
  const avgError = withActual.length > 0
    ? withActual.reduce((s, p) => s + Math.abs(p.predictedScore - (p.actualScore ?? 0)), 0) / withActual.length
    : 0;
  const avgConfidence = preds.length > 0
    ? preds.reduce((s, p) => s + p.confidence, 0) / preds.length
    : 0;

  const byRiskLevel: Record<string, { count: number; avgPredicted: number; avgActual: number }> = {};
  for (const p of withActual) {
    if (!byRiskLevel[p.riskLevel]) {
      byRiskLevel[p.riskLevel] = { count: 0, avgPredicted: 0, avgActual: 0 };
    }
    byRiskLevel[p.riskLevel].count++;
    byRiskLevel[p.riskLevel].avgPredicted += p.predictedScore;
    byRiskLevel[p.riskLevel].avgActual += (p.actualScore ?? 0);
  }
  for (const key of Object.keys(byRiskLevel)) {
    const entry = byRiskLevel[key];
    entry.avgPredicted = Math.round((entry.avgPredicted / entry.count) * 10) / 10;
    entry.avgActual = Math.round((entry.avgActual / entry.count) * 10) / 10;
  }

  return {
    totalPredictions: preds.length,
    withActual: withActual.length,
    avgError: Math.round(avgError * 100) / 100,
    avgConfidence: Math.round(avgConfidence * 100) / 100,
    byRiskLevel,
  };
}
