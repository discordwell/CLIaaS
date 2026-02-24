import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '@/lib/password';
import { createToken, createIntermediateToken, setSessionCookie } from '@/lib/auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { email, password } = parsed.data;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured. Set DATABASE_URL to enable auth.' },
        { status: 503 }
      );
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');

    // Find user by email (join to get workspace and tenant)
    const rows = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
        status: schema.users.status,
        passwordHash: schema.users.passwordHash,
        workspaceId: schema.users.workspaceId,
        tenantId: schema.workspaces.tenantId,
      })
      .from(schema.users)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.users.workspaceId))
      .where(eq(schema.users.email, email))
      .limit(1);

    const user = rows[0];
    if (!user || !user.passwordHash) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    if (user.status !== 'active') {
      return NextResponse.json(
        { error: 'Account is disabled' },
        { status: 403 }
      );
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const sessionUser = {
      id: user.id,
      email: user.email!,
      name: user.name,
      role: user.role,
      workspaceId: user.workspaceId,
      tenantId: user.tenantId,
    };

    // Check if MFA is enabled for this user
    const mfaRows = await db
      .select({ enabledAt: schema.userMfa.enabledAt })
      .from(schema.userMfa)
      .where(eq(schema.userMfa.userId, user.id))
      .limit(1);

    if (mfaRows[0]?.enabledAt) {
      // MFA is enabled — return intermediate token instead of full session
      const intermediateToken = await createIntermediateToken(sessionUser);
      return NextResponse.json({
        mfaRequired: true,
        intermediateToken,
      });
    }

    // No MFA — issue full session
    const token = await createToken(sessionUser);
    await setSessionCookie(token);

    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      workspaceId: user.workspaceId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sign-in failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
