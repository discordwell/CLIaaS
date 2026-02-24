import { NextResponse } from 'next/server';
import { hashPassword } from '@/lib/password';
import { createToken, setSessionCookie } from '@/lib/auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { createAccount, AccountExistsError } from '@/lib/auth/create-account';


export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { email, password, name, workspaceName } = parsed.data;

    if (!email || !password || !name || !workspaceName) {
      return NextResponse.json(
        { error: 'Email, password, name, and workspace name are required' },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured. Set DATABASE_URL to enable auth.' },
        { status: 503 }
      );
    }

    const passwordHash = await hashPassword(password);
    const result = await createAccount({ email, name, workspaceName, passwordHash });

    const token = await createToken({
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role as 'owner' | 'admin' | 'agent',
      workspaceId: result.workspaceId,
      tenantId: result.tenantId,
    });

    await setSessionCookie(token);

    return NextResponse.json({
      user: result.user,
      workspaceId: result.workspaceId,
    });
  } catch (err) {
    if (err instanceof AccountExistsError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : 'Signup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
