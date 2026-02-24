import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  generateTotpSecret,
  generateTotpUrl,
  generateBackupCodes,
  encryptSecret,
} from '@/lib/auth/totp';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/mfa/setup — Begin MFA setup.
 * Returns a TOTP secret, otpauth URL (for QR code), and backup codes.
 * The setup is not finalized until the user verifies a code via /api/auth/mfa/verify.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'MFA requires a database. Set DATABASE_URL to enable.' },
        { status: 503 },
      );
    }

    const { db } = await import('@/db');
    const { userMfa } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    // Check if MFA is already enabled
    const existing = await db
      .select({ id: userMfa.id, enabledAt: userMfa.enabledAt })
      .from(userMfa)
      .where(eq(userMfa.userId, auth.user.id))
      .limit(1);

    if (existing[0]?.enabledAt) {
      return NextResponse.json(
        { error: 'MFA is already enabled. Disable it first to reconfigure.' },
        { status: 409 },
      );
    }

    const secret = generateTotpSecret();
    const url = generateTotpUrl(secret, auth.user.email);
    const backupCodes = generateBackupCodes();
    const encryptedSecret = encryptSecret(secret);

    // Upsert pending MFA record (not enabled yet — enabledAt is null)
    if (existing[0]) {
      await db
        .update(userMfa)
        .set({
          totpSecret: encryptedSecret,
          backupCodes,
        })
        .where(eq(userMfa.userId, auth.user.id));
    } else {
      await db.insert(userMfa).values({
        userId: auth.user.id,
        totpSecret: encryptedSecret,
        backupCodes,
      });
    }

    return NextResponse.json({
      secret,
      url,
      backupCodes: backupCodes.map(c => c.code),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to setup MFA' },
      { status: 500 },
    );
  }
}
