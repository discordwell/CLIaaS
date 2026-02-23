import { Pool } from 'pg';
import { getPool as getMainPool } from '../../src/db/index.js';

let _ragPool: Pool | null = null;
let _ragInitFailed = false;

/**
 * Returns a pg Pool for the RAG database.
 * Uses RAG_DATABASE_URL if set, otherwise falls back to DATABASE_URL.
 * This allows running RAG storage on a dedicated pgvector database
 * while keeping the main app database vector-free.
 */
export function getRagPool(): Pool | null {
  if (_ragPool) return _ragPool;
  if (_ragInitFailed) return null;

  const connectionString = process.env.RAG_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    _ragInitFailed = true;
    return null;
  }

  try {
    _ragPool = new Pool({ connectionString });
    return _ragPool;
  } catch {
    _ragInitFailed = true;
    return null;
  }
}

/**
 * Returns the RAG pool or throws with a clear error message.
 */
export function requireRagPool(): Pool {
  const pool = getRagPool();
  if (!pool) {
    throw new Error(
      'No RAG database configured. Set RAG_DATABASE_URL (or DATABASE_URL) in your environment.',
    );
  }
  return pool;
}

/**
 * Returns the default workspace ID from the main application database.
 * This queries the main DB (DATABASE_URL), not the RAG DB.
 */
export async function getDefaultWorkspaceId(): Promise<string> {
  const pool = getMainPool();
  if (!pool) {
    throw new Error(
      'DATABASE_URL is not set. Needed to resolve workspace ID from the main database.',
    );
  }
  const result = await pool.query('SELECT id FROM workspaces LIMIT 1');
  if (result.rows.length === 0) {
    throw new Error('No workspace found. Run "cliaas db seed" or create a workspace first.');
  }
  return result.rows[0].id;
}

/**
 * Returns true if a separate RAG database is configured (RAG_DATABASE_URL is set).
 */
export function isRagDbSeparate(): boolean {
  return !!process.env.RAG_DATABASE_URL;
}
