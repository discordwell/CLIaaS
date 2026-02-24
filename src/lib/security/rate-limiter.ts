/**
 * In-memory token bucket rate limiter.
 * Provides per-key rate limiting with configurable windows.
 */

// ---- Types ----

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

// ---- Global singleton ----

declare global {
  // eslint-disable-next-line no-var
  var __cliaasRateLimiter: Map<string, RateLimitBucket> | undefined;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,   // 60 seconds
  maxRequests: 60,     // 60 requests per window (1/sec average)
};

let cleanupCounter = 0;

function getStore(): Map<string, RateLimitBucket> {
  if (!globalThis.__cliaasRateLimiter) {
    globalThis.__cliaasRateLimiter = new Map();
  }
  return globalThis.__cliaasRateLimiter;
}

function cleanupStale(config: RateLimitConfig): void {
  cleanupCounter++;
  if (cleanupCounter < 100) return;
  cleanupCounter = 0;

  const store = getStore();
  const now = Date.now();
  const staleThreshold = config.windowMs * 2;

  for (const [key, bucket] of store) {
    if (now - bucket.lastRefill > staleThreshold) {
      store.delete(key);
    }
  }
}

// ---- Public API ----

export function checkRateLimit(
  key: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
} {
  const store = getStore();
  const now = Date.now();

  cleanupStale(config);

  let bucket = store.get(key);

  if (!bucket) {
    bucket = { tokens: config.maxRequests, lastRefill: now };
    store.set(key, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  const refillRate = config.maxRequests / config.windowMs; // tokens per ms
  const tokensToAdd = elapsed * refillRate;
  bucket.tokens = Math.min(config.maxRequests, bucket.tokens + tokensToAdd);
  bucket.lastRefill = now;

  const resetAt = now + config.windowMs;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      resetAt,
    };
  }

  // Not enough tokens — calculate retry-after
  const retryAfter = Math.ceil((1 - bucket.tokens) / refillRate);

  return {
    allowed: false,
    remaining: 0,
    resetAt,
    retryAfter,
  };
}

export function getRateLimitHeaders(
  result: ReturnType<typeof checkRateLimit>,
  config?: RateLimitConfig,
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(config?.maxRequests ?? DEFAULT_CONFIG.maxRequests),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.floor(result.resetAt / 1000)),
  };

  if (result.retryAfter !== undefined) {
    headers['Retry-After'] = String(Math.ceil(result.retryAfter / 1000));
  }

  return headers;
}

export function clearBucket(key: string): void {
  getStore().delete(key);
}
