import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { verifyTotp, decryptSecret } from '@/lib/auth/totp';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireDatabase, getMfaRecord } from '@/lib/auth/mfa-helpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/mfa/disable — Disable MFA for the current user.
 * Requires a valid TOTP code to confirm.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{ code?: string }>(request);
  if ('error' in parsed) return parsed.error;

  const { code } = parsed.data;
  if (!code) {
    return NextResponse.json(
      { error: 'code is required to disable MFA' },
      { status: 400 },
    );
  }

  try {
    const dbError = requireDatabase();
    if (dbError) return dbError;

    const { db } = await import('@/db');
    const { userMfa } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    const mfaRecord = await getMfaRecord(auth.user.id);
    if (!mfaRecord || !mfaRecord.enabledAt) {
      return NextResponse.json(
        { error: 'MFA is not enabled for this user' },
        { status: 404 },
      );
    }

    const decryptedSecret = decryptSecret(mfaRecord.totpSecret);
    if (!verifyTotp(decryptedSecret, code)) {
      return NextResponse.json(
        { error: 'Invalid verification code' },
        { status: 401 },
      );
    }

    await db.delete(userMfa).where(eq(userMfa.userId, auth.user.id));

    return NextResponse.json({ mfaDisabled: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to disable MFA' },
      { status: 500 },
    );
  }
}
