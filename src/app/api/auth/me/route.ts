import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import { getSession, getJwtSecret, COOKIE_NAME } from '@/lib/auth';
import { updateProfile, sanitizeUser } from '@/lib/user-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  // Extract permissions bitfield from JWT `p` claim for the frontend
  let permissions: string | undefined;
  try {
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (token) {
      const { jwtVerify } = await import('jose');
      const { payload } = await jwtVerify(token, getJwtSecret());
      if (payload.p) permissions = String(payload.p);
    }
  } catch { /* JWT parse error — skip permissions */ }
  return NextResponse.json({ user: session, ...(permissions ? { permissions } : {}) });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const updated = await updateProfile(session.id, { name: name.trim() });
    return NextResponse.json({ user: sanitizeUser(updated) });
  } catch (err: unknown) {
    const message = safeErrorMessage(err, 'Update failed');
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
