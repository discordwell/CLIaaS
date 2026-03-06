/**
 * Volume forecasting with exponential moving average.
 */

import type { VolumeSnapshot, ForecastPoint, StaffingRecommendation, AgentSchedule } from './types';
import { countScheduledAgents } from './schedules';

export function generateForecast(
  snapshots: VolumeSnapshot[],
  options?: { daysAhead?: number }
): ForecastPoint[] {
  const daysAhead = options?.daysAhead ?? 7;
  const alpha = 0.3;

  // Group by (dayOfWeek, hour)
  const buckets = new Map<string, number[]>();
  for (const snap of snapshots) {
    const d = new Date(snap.snapshotHour);
    const dow = d.getUTCDay();
    const hour = d.getUTCHours();
    const key = `${dow}:${hour}`;
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(snap.ticketsCreated);
  }

  // EMA + stddev per bucket
  const emaMap = new Map<string, number>();
  const stdMap = new Map<string, number>();

  for (const [key, values] of buckets) {
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = alpha * values[i] + (1 - alpha) * ema;
    }
    emaMap.set(key, ema);

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.length > 1
      ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
      : 0;
    stdMap.set(key, Math.sqrt(variance));
  }

  // Generate forecast points
  const now = new Date();
  const startHour = new Date(now);
  startHour.setUTCMinutes(0, 0, 0);
  startHour.setUTCHours(startHour.getUTCHours() + 1);

  const points: ForecastPoint[] = [];
  const totalHours = daysAhead * 24;

  for (let i = 0; i < totalHours; i++) {
    const target = new Date(startHour.getTime() + i * 3600000);
    const dow = target.getUTCDay();
    const hour = target.getUTCHours();
    const key = `${dow}:${hour}`;

    const predicted = emaMap.get(key) ?? 0;
    const std = stdMap.get(key) ?? 0;
    const margin = 1.96 * std;

    const hourStr = target.toISOString().slice(0, 11) + String(hour).padStart(2, '0') + ':00:00.000Z';

    points.push({
      hour: hourStr,
      dayOfWeek: dow,
      predictedVolume: Math.round(predicted * 100) / 100,
      confidence: {
        low: Math.max(0, Math.round((predicted - margin) * 100) / 100),
        high: Math.round((predicted + margin) * 100) / 100,
      },
    });
  }

  return points;
}

export function calculateStaffing(
  forecast: ForecastPoint[],
  schedules: AgentSchedule[],
  options?: { avgHandleMinutes?: number; targetOccupancy?: number }
): StaffingRecommendation[] {
  const avgHandle = options?.avgHandleMinutes ?? 15;
  const targetOcc = options?.targetOccupancy ?? 0.75;

  return forecast.map(point => {
    const required = Math.ceil((point.predictedVolume * avgHandle) / (60 * targetOcc));
    const scheduled = countScheduledAgents(schedules, point.hour);

    return {
      hour: point.hour,
      requiredAgents: required,
      scheduledAgents: scheduled,
      gap: required - scheduled,
    };
  });
}
