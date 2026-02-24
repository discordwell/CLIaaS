import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/lib/password';
import { createToken, setSessionCookie } from '@/lib/auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { isFounderEligible } from '@/lib/billing/plans';

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

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');

    // Check if email already exists in any workspace
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

    // Create tenant (founder plan for early signups)
    const plan = isFounderEligible(new Date()) ? 'founder' : 'free';
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: workspaceName, plan })
      .returning({ id: schema.tenants.id });

    // Create workspace
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ tenantId: tenant.id, name: workspaceName })
      .returning({ id: schema.workspaces.id });

    // Create user
    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(schema.users)
      .values({
        workspaceId: workspace.id,
        email,
        passwordHash,
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

    // Create session
    const token = await createToken({
      id: user.id,
      email: user.email!,
      name: user.name,
      role: user.role as 'owner' | 'admin' | 'agent',
      workspaceId: workspace.id,
      tenantId: tenant.id,
    });

    await setSessionCookie(token);

    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      workspaceId: workspace.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
