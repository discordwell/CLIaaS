import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

declare global {
  // eslint-disable-next-line no-var
  var __cliaasPool: Pool | undefined;
}

const pool = global.__cliaasPool ?? new Pool({ connectionString });
if (process.env.NODE_ENV !== 'production') global.__cliaasPool = pool;

export const db = drizzle(pool, { schema });
export { pool };
