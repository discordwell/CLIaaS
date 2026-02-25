import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import { createToken, setSessionCookie, getJwtSecret } from '@/lib/auth';
import { isPersonalEmail, extractDomain } from '@/lib/auth/personal-domains';
import { findOrgByDomain } from '@/lib/auth/domain-matching';
import { joinWorkspace } from '@/lib/auth/create-account';

export const dynamic = 'force-dynamic';

/** Resolve the public base URL — respects reverse proxy headers. */
function publicBase(request: Request): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

export async function GET(request: Request) {
  const base = publicBase(request);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`${base}/sign-in?error=google_denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${base}/sign-in?error=google_missing_params`);
  }

  // Verify state
  const cookieStore = await cookies();
  const savedState = cookieStore.get('google-oauth-state')?.value;
  cookieStore.delete('google-oauth-state');

  if (state !== savedState) {
    return NextResponse.redirect(`${base}/sign-in?error=google_state_mismatch`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${base}/sign-in?error=google_not_configured`);
  }

  const callbackUrl = `${base}/api/auth/google/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${base}/sign-in?error=google_token_exchange`);
  }

  const tokenData = await tokenRes.json();

  // Fetch user info from Google
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    return NextResponse.redirect(`${base}/sign-in?error=google_userinfo`);
  }

  const googleUser = await userRes.json();
  const email = googleUser.email as string;
  const name = (googleUser.name as string) || email.split('@')[0];

  if (!email) {
    return NextResponse.redirect(`${base}/sign-in?error=google_no_email`);
  }

  // Check if user already exists
  if (!process.env.DATABASE_URL) {
    return NextResponse.redirect(`${base}/sign-in?error=db_not_configured`);
  }

  const { db } = await import('@/db');
  const schema = await import('@/db/schema');

  const existing = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      workspaceId: schema.users.workspaceId,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (existing.length > 0) {
    // Existing user — create session and redirect to dashboard
    const user = existing[0];
    const workspace = await db
      .select({ tenantId: schema.workspaces.tenantId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, user.workspaceId))
      .limit(1);

    const tenantId = workspace[0]?.tenantId || user.workspaceId;

    const token = await createToken({
      id: user.id,
      email: user.email!,
      name: user.name || name,
      role: user.role as 'owner' | 'admin' | 'agent',
      workspaceId: user.workspaceId,
      tenantId,
    });

    await setSessionCookie(token);
    return NextResponse.redirect(`${base}/dashboard`);
  }

  // New user with work email: check if their domain has an existing org
  if (!isPersonalEmail(email)) {
    const domain = extractDomain(email);
    const match = await findOrgByDomain(domain);
    if (match) {
      // Auto-join the existing workspace as agent
      const result = await joinWorkspace({
        email,
        name,
        passwordHash: null,
        workspaceId: match.workspaceId,
        tenantId: match.tenantId,
      });

      const token = await createToken({
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role as 'owner' | 'admin' | 'agent',
        workspaceId: result.workspaceId,
        tenantId: result.tenantId,
      });

      await setSessionCookie(token);
      return NextResponse.redirect(`${base}/dashboard`);
    }
  }

  // New user (no matching org) — create a short-lived token and redirect to workspace step
  const signupToken = await new SignJWT({ email, name, purpose: 'google-signup' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(getJwtSecret());

  return NextResponse.redirect(
    `${base}/sign-up/workspace?token=${encodeURIComponent(signupToken)}`
  );
}
