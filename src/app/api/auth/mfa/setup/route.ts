import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  generateTotpSecret,
  generateTotpUrl,
  generateBackupCodes,
  encryptSecret,
} from '@/lib/auth/totp';
import { requireDatabase, getMfaDeps } from '@/lib/auth/mfa-helpers';

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
    const dbError = requireDatabase();
    if (dbError) return dbError;

    const { db, userMfa, eq } = await getMfaDeps();

    // Check if MFA is already enabled
    const existing = await db
      .select({ id: userMfa.id, enabledAt: userMfa.enabledAt, createdAt: userMfa.createdAt })
      .from(userMfa)
      .where(eq(userMfa.userId, auth.user.id))
      .limit(1);

    if (existing[0]?.enabledAt) {
      return NextResponse.json(
        { error: 'MFA is already enabled. Disable it first to reconfigure.' },
        { status: 409 },
      );
    }

    // Prevent setup hijacking: reject if a pending (non-enabled) MFA record
    // was created less than 10 minutes ago
    if (existing[0] && !existing[0].enabledAt && existing[0].createdAt) {
      const setupAge = Date.now() - new Date(existing[0].createdAt).getTime();
      const TEN_MINUTES = 10 * 60 * 1000;
      if (setupAge < TEN_MINUTES) {
        return NextResponse.json(
          { error: 'MFA setup already in progress' },
          { status: 409 },
        );
      }
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
