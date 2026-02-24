import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyTotp, decryptSecret, verifyBackupCode, type BackupCode } from '@/lib/auth/totp';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireDatabase, getMfaRecord } from '@/lib/auth/mfa-helpers';
import { checkRateLimit } from '@/lib/security/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/mfa/verify — Verify a TOTP code.
 *
 * Two modes:
 * 1. Setup confirmation: called with session auth to finalize MFA setup
 * 2. Login verification: called with intermediate token to complete MFA login
 */
export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody<{
    code?: string;
    intermediateToken?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { code, intermediateToken } = parsed.data;

  if (!code) {
    return NextResponse.json(
      { error: 'code is required' },
      { status: 400 },
    );
  }

  try {
    const dbError = requireDatabase();
    if (dbError) return dbError;

    const { db } = await import('@/db');
    const { userMfa } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    let userId: string;
    // Store the verified payload to avoid re-verifying (race condition with 5m expiry)
    let intermediatePayload: { id: string; email: string; name: string; role: 'owner' | 'admin' | 'agent'; workspaceId: string; tenantId: string } | null = null;

    if (intermediateToken) {
      // Login verification flow — validate intermediate token
      const { verifyIntermediateToken } = await import('@/lib/auth');
      const payload = await verifyIntermediateToken(intermediateToken);
      if (!payload) {
        return NextResponse.json(
          { error: 'Invalid or expired intermediate token' },
          { status: 401 },
        );
      }
      intermediatePayload = payload;
      userId = payload.id;
    } else {
      // Setup confirmation flow — require session auth
      const { requireAuth } = await import('@/lib/api-auth');
      const auth = await requireAuth(request);
      if ('error' in auth) return auth.error;
      userId = auth.user.id;
    }

    // Per-user MFA rate limiting: 5 attempts per 15 minutes (NIST SP 800-63B aligned)
    const rateResult = checkRateLimit(`mfa:${userId}`, { windowMs: 900_000, maxRequests: 5 });
    if (!rateResult.allowed) {
      const retryMinutes = Math.ceil((rateResult.retryAfter ?? 60000) / 60000);
      return NextResponse.json(
        { error: `Too many MFA attempts. Try again in ${retryMinutes} minute${retryMinutes !== 1 ? 's' : ''}.` },
        { status: 429 },
      );
    }

    const mfaRecord = await getMfaRecord(userId);
    if (!mfaRecord) {
      return NextResponse.json(
        { error: 'MFA is not configured for this user' },
        { status: 404 },
      );
    }

    const decryptedSecret = decryptSecret(mfaRecord.totpSecret);
    let verified = verifyTotp(decryptedSecret, code);

    // If TOTP fails, try backup codes
    if (!verified) {
      const backupCodes = mfaRecord.backupCodes as BackupCode[];
      const result = verifyBackupCode(backupCodes, code);
      if (result.valid) {
        verified = true;
        // Update used backup code
        await db
          .update(userMfa)
          .set({ backupCodes: result.updatedCodes })
          .where(eq(userMfa.userId, userId));
      }
    }

    if (!verified) {
      return NextResponse.json(
        { error: 'Invalid verification code' },
        { status: 401 },
      );
    }

    // If this is setup confirmation, enable MFA
    if (!intermediateToken && !mfaRecord.enabledAt) {
      await db
        .update(userMfa)
        .set({ enabledAt: new Date() })
        .where(eq(userMfa.userId, userId));

      return NextResponse.json({
        verified: true,
        mfaEnabled: true,
      });
    }

    // If this is login verification, issue full session using cached payload
    if (intermediateToken && intermediatePayload) {
      const { createToken, setSessionCookie } = await import('@/lib/auth');

      const token = await createToken({
        id: intermediatePayload.id,
        email: intermediatePayload.email,
        name: intermediatePayload.name,
        role: intermediatePayload.role,
        workspaceId: intermediatePayload.workspaceId,
        tenantId: intermediatePayload.tenantId,
      });

      await setSessionCookie(token);

      return NextResponse.json({
        verified: true,
        user: {
          id: intermediatePayload.id,
          email: intermediatePayload.email,
          name: intermediatePayload.name,
          role: intermediatePayload.role,
        },
        workspaceId: intermediatePayload.workspaceId,
      });
    }

    return NextResponse.json({ verified: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'MFA verification failed' },
      { status: 500 },
    );
  }
}
