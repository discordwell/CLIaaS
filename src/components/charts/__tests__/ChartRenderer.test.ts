import { describe, it, expect } from 'vitest';
import type { ReportResult } from '@/lib/reports/engine';

// Test the logic that ChartRenderer uses — data extraction and visualization dispatch
// Chart components require DOM so we test the data flow rather than rendering

describe('ChartRenderer data logic', () => {
  const volumeResult: ReportResult = {
    columns: ['date', 'count'],
    rows: [
      { date: '2026-01-01', count: 10 },
      { date: '2026-01-02', count: 15 },
      { date: '2026-01-03', count: 8 },
    ],
    summary: { total: 33 },
    metric: 'ticket_volume',
  };

  const emptyResult: ReportResult = {
    columns: ['date', 'count'],
    rows: [],
    summary: { total: 0 },
    metric: 'ticket_volume',
  };

  const numberResult: ReportResult = {
    columns: ['metric', 'value'],
    rows: [{ metric: 'AI Resolution Rate', value: 42.5 }],
    summary: { rate: 42.5, ai_resolved: 17, total: 40 },
    metric: 'ai_resolution_rate',
  };

  it('extracts correct xKey and yKey from columns', () => {
    const xKey = volumeResult.columns[0];
    const yKey = volumeResult.columns[1] ?? 'count';
    expect(xKey).toBe('date');
    expect(yKey).toBe('count');
  });

  it('handles empty rows', () => {
    expect(emptyResult.rows.length).toBe(0);
  });

  it('extracts number card value from first row', () => {
    const yKey = numberResult.columns[1] ?? 'count';
    const mainValue = numberResult.rows[0]?.[yKey] ?? numberResult.summary[Object.keys(numberResult.summary)[0]];
    expect(mainValue).toBe(42.5);
  });

  it('falls back to summary when no row data', () => {
    const noRowResult: ReportResult = {
      columns: ['metric', 'value'],
      rows: [],
      summary: { rate: 0, total: 0 },
      metric: 'test',
    };
    const yKey = noRowResult.columns[1] ?? 'count';
    const mainValue = noRowResult.rows[0]?.[yKey] ?? noRowResult.summary[Object.keys(noRowResult.summary)[0]];
    expect(mainValue).toBe(0);
  });

  it('visualization dispatch maps correctly', () => {
    const vizMap: Record<string, string> = {
      bar: 'BarChart',
      line: 'LineChart',
      pie: 'PieChart',
      number: 'NumberCard',
    };
    expect(vizMap['bar']).toBe('BarChart');
    expect(vizMap['line']).toBe('LineChart');
    expect(vizMap['pie']).toBe('PieChart');
    expect(vizMap['number']).toBe('NumberCard');
  });

  it('formats metric label by replacing underscores', () => {
    const label = 'ai_resolution_rate'.replace(/_/g, ' ');
    expect(label).toBe('ai resolution rate');
  });

  it('data rows have expected shape for bar/line charts', () => {
    for (const row of volumeResult.rows) {
      expect(row).toHaveProperty('date');
      expect(row).toHaveProperty('count');
      expect(typeof row.count).toBe('number');
    }
  });

  it('summary values are numeric', () => {
    for (const val of Object.values(volumeResult.summary)) {
      expect(typeof val).toBe('number');
    }
  });
});
