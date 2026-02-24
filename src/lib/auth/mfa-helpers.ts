/**
 * Shared MFA helpers to reduce boilerplate across MFA routes.
 * - requireDatabase() checks DATABASE_URL and returns a 503 response if missing.
 * - getMfaRecord(userId) fetches the userMfa row for a given user.
 */

import { NextResponse } from 'next/server';

/**
 * Returns a 503 NextResponse if DATABASE_URL is not set, or null if the DB is available.
 */
export function requireDatabase(): NextResponse | null {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'MFA requires a database. Set DATABASE_URL to enable.' },
      { status: 503 },
    );
  }
  return null;
}

/**
 * Dynamically import database dependencies for MFA operations.
 * Centralizes the 3-line import block used across all MFA routes.
 */
export async function getMfaDeps() {
  const { db } = await import('@/db');
  const { userMfa } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  return { db, userMfa, eq };
}

/**
 * Fetch the MFA record for a user. Returns null if no record exists.
 * Uses dynamic imports to avoid hard dependency on drizzle at module load time.
 */
export async function getMfaRecord(userId: string) {
  const { db, userMfa, eq } = await getMfaDeps();

  const rows = await db
    .select()
    .from(userMfa)
    .where(eq(userMfa.userId, userId))
    .limit(1);

  return rows[0] ?? null;
}
