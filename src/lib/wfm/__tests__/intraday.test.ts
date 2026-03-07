import { describe, it, expect } from 'vitest';
import {
  getIntradayStatus,
  reforecast,
  identifyStaffingGaps,
} from '../intraday';
import type { ForecastPoint } from '../types';

// ---- Helpers ----

function makeHour(h: number): string {
  return `2026-03-07T${String(h).padStart(2, '0')}:00:00.000Z`;
}

/** Generate a 24-hour forecast with consistent predicted volume. */
function makeForecast(volumePerHour: number, hours = 24): ForecastPoint[] {
  return Array.from({ length: hours }, (_, i) => ({
    hour: makeHour(i),
    predictedVolume: volumePerHour,
    confidence: { low: Math.max(0, volumePerHour - 2), high: volumePerHour + 2 },
    dayOfWeek: 6, // Saturday
  }));
}

/** Build an actualVolumes map from a partial array of [hour-index, volume] pairs. */
function actuals(entries: Array<[number, number]>): Map<string, number> {
  const map = new Map<string, number>();
  for (const [h, v] of entries) {
    map.set(makeHour(h), v);
  }
  return map;
}

/** Build a staffing map from [hour-index, count] pairs. */
function staffing(entries: Array<[number, number]>): Map<string, number> {
  const map = new Map<string, number>();
  for (const [h, v] of entries) {
    map.set(makeHour(h), v);
  }
  return map;
}

// ---- Tests ----

describe('getIntradayStatus', () => {
  it('returns snapshots, reforecast, and staffingGaps', () => {
    const forecast = makeForecast(10);
    const actual = actuals([[0, 10], [1, 12], [2, 11]]);
    const staff = staffing([[3, 2], [4, 2]]);

    const status = getIntradayStatus(forecast, actual, staff);

    expect(status).toHaveProperty('snapshots');
    expect(status).toHaveProperty('reforecast');
    expect(status).toHaveProperty('staffingGaps');
    expect(status.snapshots).toHaveLength(3);
    // Remaining hours = 24 - 3 observed = 21
    expect(status.reforecast.remainingHours).toHaveLength(21);
  });
});

describe('variance calculation', () => {
  it('calculates variance correctly when actual > predicted', () => {
    const forecast = makeForecast(10, 4);
    const actual = actuals([[0, 15], [1, 12]]);
    const staff = new Map<string, number>();

    const status = getIntradayStatus(forecast, actual, staff);
    const snap0 = status.snapshots.find(s => s.hour === makeHour(0))!;
    const snap1 = status.snapshots.find(s => s.hour === makeHour(1))!;

    expect(snap0.variance).toBe(5);        // 15 - 10
    expect(snap0.variancePercent).toBe(50); // ((15-10)/10)*100
    expect(snap1.variance).toBe(2);         // 12 - 10
    expect(snap1.variancePercent).toBe(20); // ((12-10)/10)*100
  });

  it('calculates variance correctly when actual < predicted', () => {
    const forecast = makeForecast(10, 4);
    const actual = actuals([[0, 5]]);
    const staff = new Map<string, number>();

    const status = getIntradayStatus(forecast, actual, staff);
    const snap = status.snapshots[0];

    expect(snap.variance).toBe(-5);          // 5 - 10
    expect(snap.variancePercent).toBe(-50);   // ((5-10)/10)*100
  });

  it('handles zero predicted volume without division by zero', () => {
    const forecast: ForecastPoint[] = [
      { hour: makeHour(0), predictedVolume: 0, confidence: { low: 0, high: 0 }, dayOfWeek: 6 },
      { hour: makeHour(1), predictedVolume: 0, confidence: { low: 0, high: 0 }, dayOfWeek: 6 },
    ];
    const actual = actuals([[0, 0], [1, 5]]);
    const staff = new Map<string, number>();

    const status = getIntradayStatus(forecast, actual, staff);

    // predicted=0, actual=0 -> variancePercent=0
    const snap0 = status.snapshots.find(s => s.hour === makeHour(0))!;
    expect(Number.isFinite(snap0.variancePercent)).toBe(true);
    expect(snap0.variancePercent).toBe(0);

    // predicted=0, actual=5 -> variancePercent=100 (capped fallback)
    const snap1 = status.snapshots.find(s => s.hour === makeHour(1))!;
    expect(Number.isFinite(snap1.variancePercent)).toBe(true);
    expect(snap1.variancePercent).toBe(100);
  });
});

describe('reforecast', () => {
  it('scales up remaining hours when actual exceeds predicted by >20%', () => {
    const forecast = makeForecast(10);
    // First 6 hours: actual = 15 each (50% over)
    const actual = actuals([
      [0, 15], [1, 15], [2, 15], [3, 15], [4, 15], [5, 15],
    ]);

    const result = reforecast(forecast, actual);

    expect(result.adjustmentFactor).toBe(1.5);
    // Remaining 18 hours should be scaled to 15
    for (const point of result.remainingHours) {
      expect(point.predictedVolume).toBe(15);
    }
    expect(result.remainingHours).toHaveLength(18);
  });

  it('scales down remaining hours when actual is below predicted by >20%', () => {
    const forecast = makeForecast(10);
    // First 6 hours: actual = 5 each (50% under)
    const actual = actuals([
      [0, 5], [1, 5], [2, 5], [3, 5], [4, 5], [5, 5],
    ]);

    const result = reforecast(forecast, actual);

    expect(result.adjustmentFactor).toBe(0.5);
    // Remaining hours should be scaled to 5
    for (const point of result.remainingHours) {
      expect(point.predictedVolume).toBe(5);
    }
  });

  it('does not adjust when actual is within 20% of predicted', () => {
    const forecast = makeForecast(10);
    // First 6 hours: actual = 11 each (10% over — within threshold)
    const actual = actuals([
      [0, 11], [1, 11], [2, 11], [3, 11], [4, 11], [5, 11],
    ]);

    const result = reforecast(forecast, actual);

    expect(result.adjustmentFactor).toBe(1.0);
    for (const point of result.remainingHours) {
      expect(point.predictedVolume).toBe(10); // unchanged
    }
    expect(result.urgencyLevel).toBe('normal');
  });

  it('returns urgency normal when variance < 20%', () => {
    const forecast = makeForecast(10, 4);
    const actual = actuals([[0, 10], [1, 10]]);

    const result = reforecast(forecast, actual);
    expect(result.urgencyLevel).toBe('normal');
  });

  it('returns urgency elevated when variance 20-50%', () => {
    const forecast = makeForecast(10, 4);
    // actual 13 each → ratio 1.3 → 30% over
    const actual = actuals([[0, 13], [1, 13]]);

    const result = reforecast(forecast, actual);
    expect(result.adjustmentFactor).toBeCloseTo(1.3, 1);
    expect(result.urgencyLevel).toBe('elevated');
  });

  it('returns urgency critical when variance > 50%', () => {
    const forecast = makeForecast(10, 4);
    // actual 20 each → ratio 2.0 → 100% over
    const actual = actuals([[0, 20], [1, 20]]);

    const result = reforecast(forecast, actual);
    expect(result.adjustmentFactor).toBe(2.0);
    expect(result.urgencyLevel).toBe('critical');
  });

  it('handles all predicted = 0 with nonzero actuals', () => {
    const forecast: ForecastPoint[] = Array.from({ length: 4 }, (_, i) => ({
      hour: makeHour(i),
      predictedVolume: 0,
      confidence: { low: 0, high: 0 },
      dayOfWeek: 6,
    }));
    const actual = actuals([[0, 5], [1, 10]]);

    const result = reforecast(forecast, actual);
    // Should not produce NaN or Infinity
    expect(Number.isFinite(result.adjustmentFactor)).toBe(true);
    expect(result.adjustmentFactor).toBe(2.0); // fallback doubling
  });

  it('handles no observed hours gracefully', () => {
    const forecast = makeForecast(10, 4);
    const actual = new Map<string, number>();

    const result = reforecast(forecast, actual);
    expect(result.adjustmentFactor).toBe(1.0);
    expect(result.remainingHours).toHaveLength(4);
    expect(result.urgencyLevel).toBe('normal');
  });

  it('includes a recommendation string', () => {
    const forecast = makeForecast(10, 4);
    const actual = actuals([[0, 20]]);

    const result = reforecast(forecast, actual);
    expect(typeof result.recommendation).toBe('string');
    expect(result.recommendation.length).toBeGreaterThan(0);
  });

  it('adjusts confidence intervals along with predicted volume', () => {
    const forecast: ForecastPoint[] = [{
      hour: makeHour(5),
      predictedVolume: 10,
      confidence: { low: 6, high: 14 },
      dayOfWeek: 6,
    }];
    // Need observed hours to trigger adjustment; create full forecast
    const fullForecast: ForecastPoint[] = [
      { hour: makeHour(0), predictedVolume: 10, confidence: { low: 6, high: 14 }, dayOfWeek: 6 },
      ...forecast,
    ];
    const actual = actuals([[0, 20]]); // 100% over → factor 2.0

    const result = reforecast(fullForecast, actual);
    const adjusted = result.remainingHours[0];
    expect(adjusted.predictedVolume).toBe(20);
    expect(adjusted.confidence.low).toBe(12);
    expect(adjusted.confidence.high).toBe(28);
  });
});

describe('identifyStaffingGaps', () => {
  it('identifies hours where staffing is below required', () => {
    const forecast = makeForecast(12, 6);
    const actual = actuals([[0, 15], [1, 15]]);
    const staff = staffing([
      [2, 1], [3, 1], [4, 1], [5, 1],
    ]);

    const result = reforecast(forecast, actual);
    const gaps = identifyStaffingGaps(result, staff);

    // With factor 1.25, predicted becomes 15
    // required = ceil(15 * 15 / 45) = ceil(5) = 5
    // staffed = 1, gap = 4
    for (const gap of gaps) {
      expect(gap.gap).toBeGreaterThan(0);
      expect(gap.requiredStaffed).toBeGreaterThan(gap.currentStaffed);
    }
  });

  it('shows no gap when staffing meets requirements', () => {
    const forecast = makeForecast(4, 4);
    const actual = actuals([[0, 4], [1, 4]]);
    const staff = staffing([[2, 5], [3, 5]]);

    const result = reforecast(forecast, actual);
    const gaps = identifyStaffingGaps(result, staff);

    for (const gap of gaps) {
      expect(gap.gap).toBeLessThanOrEqual(0);
      expect(gap.urgency).toBe('normal');
    }
  });

  it('flags critical urgency when gap > 50% of required', () => {
    const forecast = makeForecast(10, 4);
    // Actual = 20 → factor 2.0 → predicted becomes 20
    const actual = actuals([[0, 20], [1, 20]]);
    // Remaining hours with 0 staff
    const staff = new Map<string, number>();

    const result = reforecast(forecast, actual);
    const gaps = identifyStaffingGaps(result, staff);

    // required > 0 and currentStaffed = 0 → gap = required → gap/required = 1.0 > 0.5 → critical
    for (const gap of gaps) {
      expect(gap.urgency).toBe('critical');
    }
  });

  it('flags elevated urgency when gap > 0 but <= 50% of required', () => {
    // Need a scenario where gap is positive but <= 50% of required
    const forecast: ForecastPoint[] = [
      { hour: makeHour(5), predictedVolume: 12, confidence: { low: 8, high: 16 }, dayOfWeek: 6 },
    ];
    const actual = new Map<string, number>(); // no observed → factor 1.0
    // required = ceil(12 * 15 / 45) = ceil(4) = 4
    // staffed = 3 → gap = 1 → 1/4 = 25% ≤ 50%
    const staff = staffing([[5, 3]]);

    const result = reforecast(forecast, actual);
    const gaps = identifyStaffingGaps(result, staff);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].gap).toBe(1);
    expect(gaps[0].urgency).toBe('elevated');
  });

  it('uses custom avgHandleMinutes and targetOccupancy', () => {
    const forecast: ForecastPoint[] = [
      { hour: makeHour(5), predictedVolume: 10, confidence: { low: 6, high: 14 }, dayOfWeek: 6 },
    ];
    const actual = new Map<string, number>();
    const staff = staffing([[5, 0]]);

    const result = reforecast(forecast, actual);

    // With default: required = ceil(10 * 15 / 45) = ceil(3.33) = 4
    const gapsDefault = identifyStaffingGaps(result, staff);
    expect(gapsDefault[0].requiredStaffed).toBe(4);

    // With custom: avgHandle=30, targetOcc=0.5
    // required = ceil(10 * 30 / (60 * 0.5)) = ceil(300/30) = ceil(10) = 10
    const gapsCustom = identifyStaffingGaps(result, staff, {
      avgHandleMinutes: 30,
      targetOccupancy: 0.5,
    });
    expect(gapsCustom[0].requiredStaffed).toBe(10);
  });

  it('handles zero predicted volume in remaining hours', () => {
    const forecast: ForecastPoint[] = [
      { hour: makeHour(0), predictedVolume: 0, confidence: { low: 0, high: 0 }, dayOfWeek: 6 },
    ];
    const actual = new Map<string, number>();
    const staff = new Map<string, number>();

    const result = reforecast(forecast, actual);
    const gaps = identifyStaffingGaps(result, staff);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].requiredStaffed).toBe(0);
    expect(gaps[0].gap).toBe(0);
    expect(gaps[0].urgency).toBe('normal');
  });
});
