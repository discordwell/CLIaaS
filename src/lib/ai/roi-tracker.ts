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
  estimatedCostPerResolution: number;
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
  const total = state.totalResolutions || 1; // avoid division by zero
  const avgConfidence = state.confidenceSum / total;

  // Estimated time saved: ~8 minutes per AI-resolved ticket
  const timeSaved = state.aiResolved * 8;

  // Estimated cost per resolution: ~$0.03 per LLM call
  const costPerResolution = total > 0 ? (state.totalResolutions * 0.03) / (state.aiResolved || 1) : 0;

  return {
    totalResolutions: state.totalResolutions,
    aiResolved: state.aiResolved,
    escalated: state.escalated,
    avgConfidence: Math.round(avgConfidence * 100) / 100,
    estimatedTimeSavedMinutes: timeSaved,
    estimatedCostPerResolution: Math.round(costPerResolution * 100) / 100,
    resolutionRate: Math.round((state.aiResolved / total) * 100),
  };
}

export function resetROIMetrics(): void {
  global.__cliaasROIMetrics = undefined;
}
