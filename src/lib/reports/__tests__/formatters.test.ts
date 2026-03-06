import { describe, it, expect } from 'vitest';
import { formatCSV, formatJSON, getContentType, getFileExtension } from '../formatters';
import type { ReportResult } from '../engine';

const mockResult: ReportResult = {
  columns: ['date', 'count'],
  rows: [
    { date: '2026-01-01', count: 10 },
    { date: '2026-01-02', count: 15 },
    { date: '2026-01-03', count: 8 },
  ],
  summary: { total: 33 },
  metric: 'ticket_volume',
  dateRange: { from: '2026-01-01', to: '2026-01-03' },
};

describe('formatCSV', () => {
  it('produces valid CSV with header and data rows', () => {
    const csv = formatCSV(mockResult);
    const lines = csv.split('\n');

    expect(lines[0]).toBe('date,count');
    expect(lines[1]).toBe('2026-01-01,10');
    expect(lines[2]).toBe('2026-01-02,15');
    expect(lines[3]).toBe('2026-01-03,8');
  });

  it('includes summary section', () => {
    const csv = formatCSV(mockResult);
    expect(csv).toContain('Summary');
    expect(csv).toContain('total,33');
  });

  it('includes date range', () => {
    const csv = formatCSV(mockResult);
    expect(csv).toContain('Date Range,2026-01-01 to 2026-01-03');
  });

  it('escapes values with commas', () => {
    const result: ReportResult = {
      columns: ['name', 'count'],
      rows: [{ name: 'Smith, John', count: 5 }],
      summary: {},
      metric: 'test',
    };
    const csv = formatCSV(result);
    expect(csv).toContain('"Smith, John"');
  });

  it('escapes values with quotes', () => {
    const result: ReportResult = {
      columns: ['name', 'count'],
      rows: [{ name: 'Say "hello"', count: 3 }],
      summary: {},
      metric: 'test',
    };
    const csv = formatCSV(result);
    expect(csv).toContain('"Say ""hello"""');
  });
});

describe('formatJSON', () => {
  it('produces valid JSON with all fields', () => {
    const json = formatJSON(mockResult);
    const parsed = JSON.parse(json);

    expect(parsed.metric).toBe('ticket_volume');
    expect(parsed.columns).toEqual(['date', 'count']);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.summary.total).toBe(33);
    expect(parsed.dateRange.from).toBe('2026-01-01');
    expect(parsed.exportedAt).toBeDefined();
  });

  it('includes null dateRange when not provided', () => {
    const result: ReportResult = {
      columns: ['name'],
      rows: [],
      summary: {},
      metric: 'test',
    };
    const parsed = JSON.parse(formatJSON(result));
    expect(parsed.dateRange).toBeNull();
  });
});

describe('getContentType', () => {
  it('returns correct MIME types', () => {
    expect(getContentType('csv')).toBe('text/csv');
    expect(getContentType('json')).toBe('application/json');
    expect(getContentType('pdf')).toBe('application/octet-stream');
  });
});

describe('getFileExtension', () => {
  it('returns correct extensions', () => {
    expect(getFileExtension('csv')).toBe('.csv');
    expect(getFileExtension('json')).toBe('.json');
    expect(getFileExtension('other')).toBe('.dat');
  });
});
