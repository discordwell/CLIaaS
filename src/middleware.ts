import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'cliaas-dev-secret-change-in-production'
);

const COOKIE_NAME = 'cliaas-session';

const PUBLIC_PATHS = [
  '/',
  '/sign-in',
  '/sign-up',
  '/docs',
  '/demo',
  '/portal',
  '/api/health',
  '/api/auth',
  '/api/email/inbound',
  '/api/portal',
  '/api/csat',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/ra/') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow static assets and public routes
  if (isStaticAsset(pathname) || isPublic(pathname)) {
    return NextResponse.next();
  }

  // In demo mode (no DB), skip auth entirely
  if (!process.env.DATABASE_URL) {
    return NextResponse.next();
  }

  // Check session cookie
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(signInUrl);
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    // Attach user info as headers for downstream use
    const response = NextResponse.next();
    response.headers.set('x-user-id', payload.id as string);
    response.headers.set('x-workspace-id', payload.workspaceId as string);
    return response;
  } catch {
    // Invalid/expired token
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('next', pathname);
    const response = NextResponse.redirect(signInUrl);
    response.cookies.delete(COOKIE_NAME);
    return response;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
