/**
 * Intraday management with reforecasting.
 *
 * Compares predicted vs actual volumes throughout the day, applies a rolling
 * adjustment factor to remaining hours, and flags staffing gaps with urgency.
 */

import type { ForecastPoint } from './types';

// ---- Interfaces ----

export interface IntradaySnapshot {
  hour: string;
  predictedVolume: number;
  actualVolume: number;
  variance: number;          // actual - predicted
  variancePercent: number;   // ((actual-predicted)/predicted) * 100
}

export interface IntradayReforecast {
  remainingHours: ForecastPoint[];
  adjustmentFactor: number;  // multiplier applied to original forecast
  urgencyLevel: 'normal' | 'elevated' | 'critical';
  recommendation: string;
}

export interface StaffingGap {
  hour: string;
  currentStaffed: number;
  requiredStaffed: number;
  gap: number;
  urgency: 'normal' | 'elevated' | 'critical';
}

export interface IntradayStatus {
  snapshots: IntradaySnapshot[];
  reforecast: IntradayReforecast;
  staffingGaps: StaffingGap[];
}

// ---- Helpers ----

function classifyUrgency(variancePercent: number): 'normal' | 'elevated' | 'critical' {
  const abs = Math.abs(variancePercent);
  if (abs > 50) return 'critical';
  if (abs > 20) return 'elevated';
  return 'normal';
}

function safeVariancePercent(actual: number, predicted: number): number {
  if (predicted === 0) {
    // Avoid division by zero: if both are 0 there is no variance;
    // if actual > 0 with no prediction, treat as 100% variance.
    return actual === 0 ? 0 : 100;
  }
  return ((actual - predicted) / predicted) * 100;
}

// ---- Core Functions ----

/**
 * Build intraday snapshots comparing predicted vs actual, then reforecast
 * and identify staffing gaps.
 *
 * @param originalForecast  Full-day forecast points (e.g. 24 hours)
 * @param actualVolumes     Map of hour-string to actual ticket volume observed so far
 * @param currentStaffing   Map of hour-string to number of agents currently scheduled
 * @param options           Optional: avgHandleMinutes, targetOccupancy for staffing calc
 */
export function getIntradayStatus(
  originalForecast: ForecastPoint[],
  actualVolumes: Map<string, number>,
  currentStaffing: Map<string, number>,
  options?: { avgHandleMinutes?: number; targetOccupancy?: number },
): IntradayStatus {
  const snapshots = buildSnapshots(originalForecast, actualVolumes);
  const reforecastResult = reforecast(originalForecast, actualVolumes);
  const staffingGaps = identifyStaffingGaps(reforecastResult, currentStaffing, options);

  return { snapshots, reforecast: reforecastResult, staffingGaps };
}

/**
 * Compare predicted vs actual for every hour that has actual data.
 */
function buildSnapshots(
  originalForecast: ForecastPoint[],
  actualVolumes: Map<string, number>,
): IntradaySnapshot[] {
  const snapshots: IntradaySnapshot[] = [];
  for (const point of originalForecast) {
    const actual = actualVolumes.get(point.hour);
    if (actual === undefined) continue; // no data for this hour yet

    const variance = actual - point.predictedVolume;
    const variancePercent = safeVariancePercent(actual, point.predictedVolume);

    snapshots.push({
      hour: point.hour,
      predictedVolume: point.predictedVolume,
      actualVolume: actual,
      variance,
      variancePercent: Math.round(variancePercent * 100) / 100,
    });
  }
  return snapshots;
}

/**
 * Apply a rolling adjustment factor to remaining (un-observed) hours.
 *
 * - Calculates the weighted mean ratio of actual/predicted for observed hours
 * - Applies that ratio as a multiplier to remaining hours
 * - If the mean ratio deviates by >20% from 1.0 the remaining forecast is scaled
 * - Urgency is based on the absolute deviation of the adjustment factor
 */
export function reforecast(
  originalForecast: ForecastPoint[],
  actualSoFar: Map<string, number>,
): IntradayReforecast {
  // Separate observed vs remaining hours
  const observedHours: Array<{ predicted: number; actual: number }> = [];
  const remainingOriginal: ForecastPoint[] = [];

  for (const point of originalForecast) {
    const actual = actualSoFar.get(point.hour);
    if (actual !== undefined) {
      observedHours.push({ predicted: point.predictedVolume, actual });
    } else {
      remainingOriginal.push(point);
    }
  }

  // Calculate adjustment factor from observed data
  let adjustmentFactor = 1.0;
  if (observedHours.length > 0) {
    const totalPredicted = observedHours.reduce((s, h) => s + h.predicted, 0);
    const totalActual = observedHours.reduce((s, h) => s + h.actual, 0);

    if (totalPredicted > 0) {
      const ratio = totalActual / totalPredicted;
      // Only adjust if deviation exceeds 20% threshold
      if (Math.abs(ratio - 1.0) > 0.20) {
        adjustmentFactor = ratio;
      }
    } else {
      // All predicted were 0 but we have actuals — scale up significantly
      if (totalActual > 0) {
        adjustmentFactor = 2.0; // double as a fallback when there's no baseline
      }
    }
  }

  // Round for cleanliness
  adjustmentFactor = Math.round(adjustmentFactor * 1000) / 1000;

  // Determine overall variance percent for urgency classification
  const variancePercent = (adjustmentFactor - 1.0) * 100;
  const urgencyLevel = classifyUrgency(variancePercent);

  // Apply adjustment to remaining forecast points
  const remainingHours: ForecastPoint[] = remainingOriginal.map(point => ({
    ...point,
    predictedVolume: Math.round(point.predictedVolume * adjustmentFactor * 100) / 100,
    confidence: {
      low: Math.max(0, Math.round(point.confidence.low * adjustmentFactor * 100) / 100),
      high: Math.round(point.confidence.high * adjustmentFactor * 100) / 100,
    },
  }));

  // Build recommendation text
  const recommendation = buildRecommendation(adjustmentFactor, urgencyLevel, remainingHours.length);

  return { remainingHours, adjustmentFactor, urgencyLevel, recommendation };
}

/**
 * Identify staffing gaps for each remaining hour in the reforecast.
 *
 * @param reforecastResult  Output of reforecast()
 * @param currentStaffing   Map of hour-string to number of agents scheduled
 * @param options           avgHandleMinutes (default 15), targetOccupancy (default 0.75)
 */
export function identifyStaffingGaps(
  reforecastResult: IntradayReforecast,
  currentStaffing: Map<string, number>,
  options?: { avgHandleMinutes?: number; targetOccupancy?: number },
): StaffingGap[] {
  const avgHandle = options?.avgHandleMinutes ?? 15;
  const targetOcc = options?.targetOccupancy ?? 0.75;

  const gaps: StaffingGap[] = [];

  for (const point of reforecastResult.remainingHours) {
    const requiredStaffed = Math.ceil(
      (point.predictedVolume * avgHandle) / (60 * targetOcc),
    );
    const currentStaffedCount = currentStaffing.get(point.hour) ?? 0;
    const gap = requiredStaffed - currentStaffedCount;

    // Determine per-hour urgency based on the gap relative to required
    let urgency: 'normal' | 'elevated' | 'critical';
    if (gap <= 0) {
      urgency = 'normal';
    } else if (requiredStaffed > 0 && gap / requiredStaffed > 0.5) {
      urgency = 'critical';
    } else if (gap > 0) {
      urgency = 'elevated';
    } else {
      urgency = 'normal';
    }

    gaps.push({
      hour: point.hour,
      currentStaffed: currentStaffedCount,
      requiredStaffed,
      gap,
      urgency,
    });
  }

  return gaps;
}

function buildRecommendation(
  factor: number,
  urgency: 'normal' | 'elevated' | 'critical',
  remainingHours: number,
): string {
  if (urgency === 'normal') {
    return `Volume is tracking within expected range. ${remainingHours} hours remaining in forecast.`;
  }

  const direction = factor > 1 ? 'higher' : 'lower';
  const pctOff = Math.abs(Math.round((factor - 1) * 100));

  if (urgency === 'critical') {
    return `CRITICAL: Actual volume is ${pctOff}% ${direction} than forecast. ` +
      `Remaining ${remainingHours} hours adjusted by ${factor}x. Immediate staffing review recommended.`;
  }

  return `Volume is trending ${pctOff}% ${direction} than forecast. ` +
    `Remaining ${remainingHours} hours adjusted by ${factor}x. Consider staffing adjustments.`;
}
