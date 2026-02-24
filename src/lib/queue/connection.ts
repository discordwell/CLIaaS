/**
 * Redis connection singleton — same lazy-init pattern as src/db/index.ts.
 * Returns null when REDIS_URL is not set (demo mode / no Redis).
 */

import Redis from 'ioredis';

declare global {
  var __cliaasRedis: Redis | undefined;
}

let _redis: Redis | null = null;
let _initFailed = false;

function init(): boolean {
  if (_initFailed) return false;

  const url = process.env.REDIS_URL;
  if (!url) {
    _initFailed = true;
    return false;
  }

  try {
    _redis = global.__cliaasRedis ?? new Redis(url, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      lazyConnect: true,
    });
    if (process.env.NODE_ENV !== 'production') global.__cliaasRedis = _redis;
    return true;
  } catch {
    _initFailed = true;
    return false;
  }
}

/** Returns the ioredis instance, or null if REDIS_URL is not configured. */
export function getRedis(): Redis | null {
  if (!_redis && !init()) return null;
  return _redis;
}

/** Returns true if REDIS_URL is configured and a connection can be created. */
export function isRedisAvailable(): boolean {
  return getRedis() !== null;
}

/** IORedis connection options for BullMQ (creates new connections per worker). */
export function getRedisConnectionOpts(): { connection: Redis } | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  return {
    connection: new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    }),
  };
}

/** Gracefully close the shared Redis connection. */
export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit().catch(() => {});
    _redis = null;
  }
  _initFailed = false;
}
