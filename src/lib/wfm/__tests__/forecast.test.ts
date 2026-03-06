import { describe, it, expect } from 'vitest';
import { generateForecast, calculateStaffing } from '../forecast';
import type { VolumeSnapshot, AgentSchedule } from '../types';

function makeSyntheticSnapshots(weeks: number): VolumeSnapshot[] {
  const snapshots: VolumeSnapshot[] = [];
  // Use a fixed start date (Monday 2026-02-02) so day-of-week is deterministic
  const baseDate = new Date('2026-02-02T00:00:00Z');
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const dt = new Date(baseDate.getTime() + (w * 7 + d) * 86400000 + h * 3600000);
        const bh = h >= 9 && h < 17;
        const base = bh ? 10 : 2;
        snapshots.push({
          id: `vs-${w}-${d}-${h}`,
          snapshotHour: dt.toISOString().slice(0, 14) + '00:00.000Z',
          channel: 'all',
          ticketsCreated: base,
          ticketsResolved: Math.max(0, base - 1),
        });
      }
    }
  }
  return snapshots;
}

describe('generateForecast', () => {
  it('returns forecast points for the requested days', () => {
    const snapshots = makeSyntheticSnapshots(2);
    const forecast = generateForecast(snapshots, { daysAhead: 3 });
    expect(forecast.length).toBe(3 * 24);
  });

  it('each point has required fields', () => {
    const snapshots = makeSyntheticSnapshots(2);
    const forecast = generateForecast(snapshots, { daysAhead: 1 });
    for (const point of forecast) {
      expect(point).toHaveProperty('hour');
      expect(point).toHaveProperty('predictedVolume');
      expect(point).toHaveProperty('confidence');
      expect(point.confidence).toHaveProperty('low');
      expect(point.confidence).toHaveProperty('high');
      expect(point).toHaveProperty('dayOfWeek');
      expect(point.confidence.low).toBeLessThanOrEqual(point.predictedVolume);
      expect(point.confidence.high).toBeGreaterThanOrEqual(point.predictedVolume);
    }
  });

  it('predicts higher volume during business hours', () => {
    const snapshots = makeSyntheticSnapshots(4);
    const forecast = generateForecast(snapshots, { daysAhead: 7 });
    const bhPoints = forecast.filter(p => {
      const hour = parseInt(p.hour.slice(11, 13));
      return hour >= 9 && hour < 17;
    });
    const nonBhPoints = forecast.filter(p => {
      const hour = parseInt(p.hour.slice(11, 13));
      return hour < 9 || hour >= 17;
    });
    const avgBh = bhPoints.reduce((s, p) => s + p.predictedVolume, 0) / (bhPoints.length || 1);
    const avgNonBh = nonBhPoints.reduce((s, p) => s + p.predictedVolume, 0) / (nonBhPoints.length || 1);
    expect(avgBh).toBeGreaterThan(avgNonBh);
  });

  it('handles empty snapshots', () => {
    const forecast = generateForecast([], { daysAhead: 1 });
    expect(forecast.length).toBe(24);
    for (const point of forecast) {
      expect(point.predictedVolume).toBe(0);
    }
  });

  it('handles single week of data', () => {
    const snapshots = makeSyntheticSnapshots(1);
    const forecast = generateForecast(snapshots, { daysAhead: 1 });
    expect(forecast.length).toBe(24);
    // With single data point per bucket, stddev=0 so confidence interval collapses
    for (const point of forecast) {
      expect(point.confidence.low).toBe(point.predictedVolume);
      expect(point.confidence.high).toBe(point.predictedVolume);
    }
  });
});

describe('calculateStaffing', () => {
  it('calculates required agents based on forecast', () => {
    const forecast = [
      { hour: '2026-03-02T10:00:00.000Z', predictedVolume: 12, confidence: { low: 8, high: 16 }, dayOfWeek: 1 },
    ];
    const schedules: AgentSchedule[] = [];
    const staffing = calculateStaffing(forecast, schedules, { avgHandleMinutes: 15, targetOccupancy: 0.75 });
    expect(staffing).toHaveLength(1);
    // required = ceil(12 * 15 / (60 * 0.75)) = ceil(180/45) = 4
    expect(staffing[0].requiredAgents).toBe(4);
    expect(staffing[0].scheduledAgents).toBe(0);
    expect(staffing[0].gap).toBe(4);
  });

  it('shows negative gap when overstaffed', () => {
    const forecast = [
      { hour: '2026-03-02T12:00:00.000Z', predictedVolume: 1, confidence: { low: 0, high: 2 }, dayOfWeek: 1 },
    ];
    // Schedule with work shift covering that hour
    const schedules: AgentSchedule[] = [
      {
        id: 's1', userId: 'u1', userName: 'A', effectiveFrom: '2026-01-01',
        timezone: 'UTC', shifts: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' }],
        createdAt: '', updatedAt: '',
      },
      {
        id: 's2', userId: 'u2', userName: 'B', effectiveFrom: '2026-01-01',
        timezone: 'UTC', shifts: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' }],
        createdAt: '', updatedAt: '',
      },
    ];
    const staffing = calculateStaffing(forecast, schedules, { avgHandleMinutes: 15, targetOccupancy: 0.75 });
    // required = ceil(1 * 15 / 45) = 1, scheduled = 2, gap = -1
    expect(staffing[0].gap).toBeLessThan(0);
  });
});
