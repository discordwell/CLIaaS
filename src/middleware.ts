import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { getSecurityHeaders } from '@/lib/security/headers';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limiter';
import { createLogger } from '@/lib/logger';

const logger = createLogger('middleware');

let _jwtSecret: Uint8Array | null = null;

function getJwtSecret(): Uint8Array {
  if (!_jwtSecret) {
    const secret = process.env.AUTH_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET environment variable is required in production');
    }
    _jwtSecret = new TextEncoder().encode(secret || 'cliaas-dev-secret-change-in-production');
  }
  return _jwtSecret;
}

const COOKIE_NAME = 'cliaas-session';

const PUBLIC_PATHS = [
  '/',
  '/sign-in',
  '/sign-up',
  '/docs',
  '/demo',
  '/portal',
  '/api/health',
  '/api/auth/signin',
  '/api/auth/signup',
  '/api/auth/sso/saml/callback',
  '/api/auth/sso/saml/metadata',
  '/api/auth/sso/saml/login',
  '/api/auth/sso/oidc/callback',
  '/api/auth/sso/oidc/login',
  '/api/email/inbound',
  '/api/portal',
  '/api/csat',
  // SMS/WhatsApp webhook (Twilio)
  '/api/channels/sms/inbound',
  // Voice webhooks (Twilio)
  '/api/channels/voice/inbound',
  '/api/channels/voice/status',
  // Social media webhooks
  '/api/channels/facebook/webhook',
  '/api/channels/instagram/webhook',
  '/api/channels/twitter/webhook',
  // Zendesk webhook (has its own ZENDESK_WEBHOOK_SECRET verification)
  '/api/zendesk/webhook',
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

function applySecurityHeaders(response: NextResponse): void {
  const headers = getSecurityHeaders();
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow static assets
  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  logger.info({ method: request.method, pathname }, 'Incoming request');

  // Rate limiting for API routes
  if (pathname.startsWith('/api/')) {
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const result = checkRateLimit(clientIp);
    if (!result.allowed) {
      const rateLimitResponse = NextResponse.json(
        { error: 'Too many requests', retryAfter: result.retryAfter },
        { status: 429 }
      );
      const rlHeaders = getRateLimitHeaders(result);
      for (const [key, value] of Object.entries(rlHeaders)) {
        rateLimitResponse.headers.set(key, value);
      }
      applySecurityHeaders(rateLimitResponse);
      return rateLimitResponse;
    }
  }

  // Allow public routes
  if (isPublic(pathname)) {
    const response = NextResponse.next();
    applySecurityHeaders(response);
    return response;
  }

  // In demo mode (no DB), skip auth entirely
  if (!process.env.DATABASE_URL) {
    const response = NextResponse.next();
    applySecurityHeaders(response);
    return response;
  }

  // Check session cookie
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const isApiRoute = pathname.startsWith('/api/');

  if (!token) {
    if (isApiRoute) {
      const response = NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
      applySecurityHeaders(response);
      return response;
    }
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('next', pathname);
    const response = NextResponse.redirect(signInUrl);
    applySecurityHeaders(response);
    return response;
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    // Attach user info as headers for downstream use
    const response = NextResponse.next();
    response.headers.set('x-user-id', payload.id as string);
    response.headers.set('x-workspace-id', payload.workspaceId as string);
    response.headers.set('x-user-role', (payload.role as string) || '');
    response.headers.set('x-user-email', (payload.email as string) || '');
    applySecurityHeaders(response);
    return response;
  } catch {
    // Invalid/expired token
    if (isApiRoute) {
      const response = NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
      response.cookies.delete(COOKIE_NAME);
      applySecurityHeaders(response);
      return response;
    }
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('next', pathname);
    const response = NextResponse.redirect(signInUrl);
    response.cookies.delete(COOKIE_NAME);
    applySecurityHeaders(response);
    return response;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
