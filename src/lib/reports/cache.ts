/**
 * Report cache — SHA-256 hash lookup with TTL.
 * 5-min TTL for live metrics, 1-hour for historical reports.
 */

import { createHash } from 'crypto';
import type { ReportResult, DateRange } from './engine';

interface CacheEntry {
  result: ReportResult;
  expiresAt: number;
}

// In-memory cache (process-scoped)
const cache = new Map<string, CacheEntry>();

const LIVE_TTL_MS = 5 * 60 * 1000;       // 5 minutes
const HISTORICAL_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Generate a cache key from report ID + filters + date range.
 */
export function computeCacheKey(
  reportId: string,
  filters?: Record<string, unknown>,
  dateRange?: DateRange,
): string {
  const payload = JSON.stringify({ reportId, filters: filters ?? {}, dateRange: dateRange ?? null });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Check if a cached result exists and is still valid.
 */
export function getCached(cacheKey: string): ReportResult | null {
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(cacheKey);
    return null;
  }
  return entry.result;
}

/**
 * Store a result in the cache with appropriate TTL.
 * Historical reports (with dateRange.to in the past) get longer TTL.
 */
export function setCache(
  cacheKey: string,
  result: ReportResult,
  dateRange?: DateRange,
): void {
  const isHistorical = dateRange?.to
    ? new Date(dateRange.to).getTime() < Date.now() - 24 * 60 * 60 * 1000
    : false;

  const ttl = isHistorical ? HISTORICAL_TTL_MS : LIVE_TTL_MS;

  cache.set(cacheKey, {
    result,
    expiresAt: Date.now() + ttl,
  });
}

/**
 * Invalidate a specific cache entry.
 */
export function invalidateCache(cacheKey: string): void {
  cache.delete(cacheKey);
}

/**
 * Clear all cached entries.
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Evict expired entries (called periodically or on demand).
 */
export function evictExpired(): number {
  let evicted = 0;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expiresAt) {
      cache.delete(key);
      evicted++;
    }
  }
  return evicted;
}
