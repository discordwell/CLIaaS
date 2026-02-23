import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  var __cliaasPool: Pool | undefined;
}

let _db: AppDb | null = null;
let _pool: Pool | null = null;
let _initFailed = false;

function init(): boolean {
  if (_initFailed) return false;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Demo mode: no database configured — this is fine
    _initFailed = true;
    return false;
  }

  try {
    _pool = global.__cliaasPool ?? new Pool({ connectionString });
    if (process.env.NODE_ENV !== 'production') global.__cliaasPool = _pool;
    _db = drizzle(_pool, { schema });
    return true;
  } catch {
    _initFailed = true;
    return false;
  }
}

/**
 * Returns the Drizzle DB instance, or null if DATABASE_URL is not configured.
 * Safe to call in demo mode without crashing.
 */
export function getDb(): AppDb | null {
  if (!_db && !init()) return null;
  return _db;
}

/**
 * Returns the pg Pool instance, or null if DATABASE_URL is not configured.
 * Safe to call in demo mode without crashing.
 */
export function getPool(): Pool | null {
  if (!_pool && !init()) return null;
  return _pool;
}

/** Returns true if a DATABASE_URL is configured and the DB connection is available. */
export function isDatabaseAvailable(): boolean {
  return getDb() !== null;
}

// Backward-compatible: lazy proxy so import doesn't throw.
// Accessing properties will throw only when DATABASE_URL is missing AND a DB
// operation is actually attempted (e.g. db.select()), which preserves the
// existing fail-fast behavior for code paths that require a real database.
export const db = new Proxy({} as AppDb, {
  get(_, prop) {
    const instance = getDb();
    if (!instance) {
      throw new Error(
        'DATABASE_URL is not set. The app is running in demo mode — database operations are unavailable.',
      );
    }
    return (instance as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export const pool = new Proxy({} as Pool, {
  get(_, prop) {
    const instance = getPool();
    if (!instance) {
      throw new Error(
        'DATABASE_URL is not set. The app is running in demo mode — database operations are unavailable.',
      );
    }
    return (instance as unknown as Record<string | symbol, unknown>)[prop];
  },
});
