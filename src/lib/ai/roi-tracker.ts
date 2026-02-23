/**
 * AI resolution ROI tracker. Tracks resolution metrics for dashboard display.
 */

import type { AIAgentResult } from './agent';

export interface ROIMetrics {
  totalResolutions: number;
  aiResolved: number;
  escalated: number;
  avgConfidence: number;
  estimatedTimeSavedMinutes: number;
  avgCostPerResolution: number;
  resolutionRate: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __cliaasROIMetrics: {
    totalResolutions: number;
    aiResolved: number;
    escalated: number;
    confidenceSum: number;
  } | undefined;
}

function getMetricsState() {
  return global.__cliaasROIMetrics ?? {
    totalResolutions: 0,
    aiResolved: 0,
    escalated: 0,
    confidenceSum: 0,
  };
}

export function recordResolution(result: AIAgentResult): void {
  const state = getMetricsState();
  state.totalResolutions++;
  state.confidenceSum += result.confidence;
  if (result.resolved) state.aiResolved++;
  if (result.escalated) state.escalated++;
  global.__cliaasROIMetrics = state;
}

export function getROIMetrics(): ROIMetrics {
  const state = getMetricsState();
  const total = state.totalResolutions;
  const avgConfidence = total > 0 ? state.confidenceSum / total : 0;

  // Estimated time saved: ~8 minutes per AI-resolved ticket
  const timeSaved = state.aiResolved * 8;

  // Average cost per AI resolution: ~$0.03 per LLM call
  const avgCost = state.aiResolved > 0
    ? (state.totalResolutions * 0.03) / state.aiResolved
    : 0;

  return {
    totalResolutions: state.totalResolutions,
    aiResolved: state.aiResolved,
    escalated: state.escalated,
    avgConfidence: Math.round(avgConfidence * 100) / 100,
    estimatedTimeSavedMinutes: timeSaved,
    avgCostPerResolution: Math.round(avgCost * 100) / 100,
    resolutionRate: total > 0 ? Math.round((state.aiResolved / total) * 100) : 0,
  };
}

export function resetROIMetrics(): void {
  global.__cliaasROIMetrics = undefined;
}
