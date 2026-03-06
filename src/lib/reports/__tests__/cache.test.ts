import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeCacheKey, getCached, setCache, invalidateCache, clearCache, evictExpired } from '../cache';
import type { ReportResult } from '../engine';

const mockResult: ReportResult = {
  columns: ['date', 'count'],
  rows: [{ date: '2026-01-01', count: 10 }],
  summary: { total: 10 },
  metric: 'ticket_volume',
};

describe('Report Cache', () => {
  beforeEach(() => {
    clearCache();
  });

  it('computeCacheKey produces consistent SHA-256 hash', () => {
    const key1 = computeCacheKey('report-1', { status: 'open' }, { from: '2026-01-01', to: '2026-01-31' });
    const key2 = computeCacheKey('report-1', { status: 'open' }, { from: '2026-01-01', to: '2026-01-31' });
    expect(key1).toBe(key2);
    expect(key1.length).toBe(64); // SHA-256 hex
  });

  it('computeCacheKey produces different hashes for different inputs', () => {
    const key1 = computeCacheKey('report-1');
    const key2 = computeCacheKey('report-2');
    expect(key1).not.toBe(key2);
  });

  it('setCache and getCached round-trip', () => {
    const key = computeCacheKey('report-1');
    setCache(key, mockResult);
    const cached = getCached(key);
    expect(cached).toEqual(mockResult);
  });

  it('getCached returns null for missing key', () => {
    expect(getCached('nonexistent')).toBeNull();
  });

  it('invalidateCache removes entry', () => {
    const key = computeCacheKey('report-1');
    setCache(key, mockResult);
    expect(getCached(key)).not.toBeNull();
    invalidateCache(key);
    expect(getCached(key)).toBeNull();
  });

  it('clearCache removes all entries', () => {
    setCache(computeCacheKey('r1'), mockResult);
    setCache(computeCacheKey('r2'), mockResult);
    clearCache();
    expect(getCached(computeCacheKey('r1'))).toBeNull();
    expect(getCached(computeCacheKey('r2'))).toBeNull();
  });

  it('getCached returns null for expired entries', () => {
    const key = computeCacheKey('report-1');
    setCache(key, mockResult);
    // Manually expire the entry by advancing time
    vi.useFakeTimers();
    vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes, beyond 5-min live TTL
    expect(getCached(key)).toBeNull();
    vi.useRealTimers();
  });

  it('evictExpired removes expired entries', () => {
    const key = computeCacheKey('report-1');
    setCache(key, mockResult);
    vi.useFakeTimers();
    vi.advanceTimersByTime(6 * 60 * 1000);
    const count = evictExpired();
    expect(count).toBe(1);
    vi.useRealTimers();
  });

  it('historical reports get longer TTL', () => {
    const key = computeCacheKey('report-old');
    const oldDateRange = { from: '2025-01-01', to: '2025-01-31' };
    setCache(key, mockResult, oldDateRange);
    vi.useFakeTimers();
    vi.advanceTimersByTime(30 * 60 * 1000); // 30 min — within 1h historical TTL
    expect(getCached(key)).not.toBeNull();
    vi.advanceTimersByTime(31 * 60 * 1000); // total 61 min — beyond 1h
    expect(getCached(key)).toBeNull();
    vi.useRealTimers();
  });
});
