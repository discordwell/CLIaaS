import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/portal/magic-link';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 });
  }

  const result = verifyToken(token);

  if (!result.valid || !result.email) {
    return NextResponse.json(
      { error: result.error ?? 'Invalid token' },
      { status: 401 }
    );
  }

  // Set the portal email cookie now that the token is verified
  const response = NextResponse.redirect(
    new URL('/portal/tickets', request.url),
  );

  response.cookies.set('cliaas-portal-email', result.email, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: '/',
  });

  return response;
}
