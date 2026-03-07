import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  var __cliaasPool: Pool | undefined;
  var __cliaasRlsPool: Pool | undefined;
}

let _db: AppDb | null = null;
let _pool: Pool | null = null;
let _initFailed = false;

let _rlsDb: AppDb | null = null;
let _rlsPool: Pool | null = null;
let _rlsInitFailed = false;

function init(): boolean {
  if (_initFailed) return false;

  // Main pool uses DATABASE_URL (superuser). All existing code paths use this.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
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

function initRls(): boolean {
  if (_rlsInitFailed) return false;

  // RLS pool uses DATABASE_APP_ROLE_URL (cliaas_app role, no BYPASSRLS).
  // Used exclusively by withRls() for workspace-scoped transactions.
  const connectionString = process.env.DATABASE_APP_ROLE_URL;
  if (!connectionString) {
    // No RLS role configured — withRls() falls back to superuser pool
    _rlsInitFailed = true;
    return false;
  }

  try {
    _rlsPool = global.__cliaasRlsPool ?? new Pool({ connectionString });
    if (process.env.NODE_ENV !== 'production') global.__cliaasRlsPool = _rlsPool;
    _rlsDb = drizzle(_rlsPool, { schema });
    return true;
  } catch {
    _rlsInitFailed = true;
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

/**
 * Returns a Drizzle DB using DATABASE_APP_ROLE_URL (cliaas_app role, RLS-enforced).
 * Falls back to getDb() (superuser) if no APP_ROLE_URL is configured.
 * Used exclusively by withRls() for workspace-scoped transactions.
 */
export function getRlsDb(): AppDb | null {
  if (_rlsDb) return _rlsDb;
  if (!_rlsInitFailed && initRls()) return _rlsDb;
  // Fall back to superuser DB if no RLS role configured
  return getDb();
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

// Backward compat alias — db already uses superuser, so adminDb is the same
export const adminDb = db;

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
