/**
 * Write-ahead buffer for audit log persistence.
 * Failed DB writes queue here and flush on the next successful write.
 * Shared by both audit.ts and security/audit-log.ts.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('audit-wal');

export interface WalEntry<T> {
  payload: T;
  attempts: number;
  firstFailedAt: number;
}

const MAX_WAL_SIZE = 500;
const MAX_ATTEMPTS = 5;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

declare global {
  // eslint-disable-next-line no-var
  var __cliaasAuditWal: WalEntry<unknown>[] | undefined;
  // eslint-disable-next-line no-var
  var __cliaasSecureAuditWal: WalEntry<unknown>[] | undefined;
}

function getBuffer(key: '__cliaasAuditWal' | '__cliaasSecureAuditWal'): WalEntry<unknown>[] {
  if (!globalThis[key]) {
    globalThis[key] = [];
  }
  return globalThis[key]!;
}

/**
 * Add a failed write to the WAL buffer.
 */
export function walEnqueue<T>(
  walKey: '__cliaasAuditWal' | '__cliaasSecureAuditWal',
  payload: T,
): void {
  const buf = getBuffer(walKey);

  // Evict entries that are too old or have too many attempts
  const now = Date.now();
  for (let i = buf.length - 1; i >= 0; i--) {
    const entry = buf[i];
    if (entry.attempts >= MAX_ATTEMPTS || now - entry.firstFailedAt > MAX_AGE_MS) {
      logger.warn(
        { attempts: entry.attempts, ageMs: now - entry.firstFailedAt },
        'Dropping audit WAL entry after max retries/age',
      );
      buf.splice(i, 1);
    }
  }

  // Enforce max size
  if (buf.length >= MAX_WAL_SIZE) {
    logger.warn('Audit WAL buffer full, dropping oldest entry');
    buf.shift();
  }

  buf.push({ payload, attempts: 1, firstFailedAt: now });
}

/**
 * Attempt to flush all pending WAL entries using the provided writer function.
 * Returns the number of successfully flushed entries.
 */
export async function walFlush<T>(
  walKey: '__cliaasAuditWal' | '__cliaasSecureAuditWal',
  writer: (payload: T) => Promise<void>,
): Promise<number> {
  const buf = getBuffer(walKey);
  if (buf.length === 0) return 0;

  let flushed = 0;
  const remaining: WalEntry<unknown>[] = [];

  for (const entry of buf) {
    try {
      await writer(entry.payload as T);
      flushed++;
    } catch {
      entry.attempts++;
      if (entry.attempts < MAX_ATTEMPTS) {
        remaining.push(entry);
      } else {
        logger.warn({ attempts: entry.attempts }, 'Dropping audit WAL entry after max retries');
      }
    }
  }

  // Replace buffer contents
  buf.length = 0;
  buf.push(...remaining);

  if (flushed > 0) {
    logger.info({ flushed, remaining: remaining.length }, 'Flushed audit WAL entries');
  }

  return flushed;
}

/**
 * Returns the current WAL buffer size for monitoring.
 */
export function walSize(walKey: '__cliaasAuditWal' | '__cliaasSecureAuditWal'): number {
  return getBuffer(walKey).length;
}

/**
 * Clear the WAL buffer (for testing).
 */
export function walClear(walKey: '__cliaasAuditWal' | '__cliaasSecureAuditWal'): void {
  const buf = getBuffer(walKey);
  buf.length = 0;
}
