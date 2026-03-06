import { describe, it, expect } from 'vitest';
import { METRIC_REGISTRY, getMetric, validateGroupBy, listMetrics } from '../metrics';

describe('Metric Registry', () => {
  it('has 20 metrics defined', () => {
    expect(METRIC_REGISTRY.length).toBe(20);
  });

  it('all metrics have unique keys', () => {
    const keys = METRIC_REGISTRY.map(m => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('all metrics have required fields', () => {
    for (const m of METRIC_REGISTRY) {
      expect(m.key).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.description).toBeTruthy();
      expect(m.sourceTables.length).toBeGreaterThan(0);
      expect(m.aggregation).toBeTruthy();
      expect(Array.isArray(m.validGroupBy)).toBe(true);
    }
  });

  it('getMetric returns correct metric', () => {
    const metric = getMetric('ticket_volume');
    expect(metric).toBeDefined();
    expect(metric!.key).toBe('ticket_volume');
    expect(metric!.aggregation).toBe('count');
  });

  it('getMetric returns undefined for unknown key', () => {
    expect(getMetric('nonexistent')).toBeUndefined();
  });

  it('validateGroupBy filters invalid dimensions', () => {
    const valid = validateGroupBy('ticket_volume', ['date', 'status', 'invalid']);
    expect(valid).toEqual(['date', 'status']);
  });

  it('validateGroupBy returns empty for unknown metric', () => {
    expect(validateGroupBy('unknown', ['date'])).toEqual([]);
  });

  it('listMetrics returns simplified entries', () => {
    const list = listMetrics();
    expect(list.length).toBe(20);
    expect(list[0]).toHaveProperty('key');
    expect(list[0]).toHaveProperty('label');
    expect(list[0]).toHaveProperty('description');
    expect(list[0]).not.toHaveProperty('sourceTables');
  });
});
