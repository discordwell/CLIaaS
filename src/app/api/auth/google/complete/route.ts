import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { createToken, setSessionCookie, getJwtSecret } from '@/lib/auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { createOrJoinAccount, AccountExistsError } from '@/lib/auth/create-account';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  const { token, workspaceName } = parsed.data;

  if (!token) {
    return NextResponse.json(
      { error: 'Token is required' },
      { status: 400 }
    );
  }

  // Verify the short-lived signup token
  let email: string;
  let name: string;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (payload.purpose !== 'google-signup') {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }
    email = payload.email as string;
    name = payload.name as string;
  } catch {
    return NextResponse.json({ error: 'Token expired or invalid' }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  try {
    const result = await createOrJoinAccount({ email, name, workspaceName, passwordHash: null });

    const sessionToken = await createToken({
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role as 'owner' | 'admin' | 'agent',
      workspaceId: result.workspaceId,
      tenantId: result.tenantId,
    });

    await setSessionCookie(sessionToken);

    return NextResponse.json({
      user: result.user,
      workspaceId: result.workspaceId,
      joined: result.joined,
      orgName: result.orgName,
    });
  } catch (err) {
    if (err instanceof AccountExistsError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : 'Signup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
