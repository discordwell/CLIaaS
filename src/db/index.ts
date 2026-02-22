import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

declare global {
  var __cliaasPool: Pool | undefined;
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _pool: Pool | null = null;

function init() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  _pool = global.__cliaasPool ?? new Pool({ connectionString });
  if (process.env.NODE_ENV !== 'production') global.__cliaasPool = _pool;
  _db = drizzle(_pool, { schema });
}

export function getDb() {
  if (!_db) init();
  return _db!;
}

export function getPool() {
  if (!_pool) init();
  return _pool!;
}

// Backward-compatible: lazy getter so import doesn't throw
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export const pool = new Proxy({} as Pool, {
  get(_, prop) {
    return (getPool() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
