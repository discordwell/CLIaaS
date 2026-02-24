import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { eq } from 'drizzle-orm';
import { createToken, setSessionCookie, getJwtSecret } from '@/lib/auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  const { token, workspaceName } = parsed.data;

  if (!token || !workspaceName) {
    return NextResponse.json(
      { error: 'Token and workspace name are required' },
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

  const { db } = await import('@/db');
  const schema = await import('@/db/schema');

  // Double-check email not taken (race condition guard)
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: 'An account with this email already exists' },
      { status: 409 }
    );
  }

  // Create tenant + workspace + user (same as signup/route.ts but no password)
  const plan = 'byoc';
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: workspaceName, plan })
    .returning({ id: schema.tenants.id });

  const [workspace] = await db
    .insert(schema.workspaces)
    .values({ tenantId: tenant.id, name: workspaceName })
    .returning({ id: schema.workspaces.id });

  const [user] = await db
    .insert(schema.users)
    .values({
      workspaceId: workspace.id,
      email,
      passwordHash: null,
      name,
      role: 'owner',
      status: 'active',
    })
    .returning({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
    });

  const sessionToken = await createToken({
    id: user.id,
    email: user.email!,
    name: user.name || name,
    role: user.role as 'owner' | 'admin' | 'agent',
    workspaceId: workspace.id,
    tenantId: tenant.id,
  });

  await setSessionCookie(sessionToken);

  return NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    workspaceId: workspace.id,
  });
}
