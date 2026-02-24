import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { getSecurityHeaders } from '@/lib/security/headers';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limiter';
import { createLogger } from '@/lib/logger';
import { getJwtSecret, COOKIE_NAME } from '@/lib/auth';

const logger = createLogger('middleware');

const PUBLIC_PATHS = [
  '/',
  '/sign-in',
  '/sign-up',
  '/docs',
  '/demo',
  '/portal',
  '/api/health',
  '/api/metrics',
  '/api/auth/signin',
  '/api/auth/signup',
  '/api/auth/signout',
  '/api/auth/me',
  '/api/auth/mfa/verify',
  '/api/auth/sso/saml/callback',
  '/api/auth/sso/saml/metadata',
  '/api/auth/sso/saml/login',
  '/api/auth/sso/oidc/callback',
  '/api/auth/sso/oidc/login',
  '/api/email/inbound',
  '/api/portal',
  '/api/csat',
  '/api/docs',
  '/api/chat/widget.js',
  '/api/scim/v2',
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
  // Stripe webhook (verified via stripe-signature header)
  '/api/stripe/webhook',
];

const API_KEY_PREFIX = 'cliaas_';
const API_KEY_RATE_LIMIT = { windowMs: 60_000, maxRequests: 120 };

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

// Internal headers that must not be set by clients
const INTERNAL_HEADERS = ['x-auth-type', 'x-user-id', 'x-workspace-id', 'x-user-role', 'x-user-email', 'x-tenant-id'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Strip internal headers from incoming requests to prevent injection
  const requestHeaders = new Headers(request.headers);
  for (const header of INTERNAL_HEADERS) {
    requestHeaders.delete(header);
  }

  // Always allow static assets
  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  // Generate/propagate request correlation ID
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  requestHeaders.set('x-request-id', requestId);

  // Attach request timing header for downstream duration calculation
  requestHeaders.set('x-request-start', Date.now().toString());

  logger.info({ method: request.method, pathname, requestId }, 'Incoming request');

  // Rate limiting for API routes
  if (pathname.startsWith('/api/')) {
    // Determine rate limit key: API key prefix or client IP
    const authHeader = request.headers.get('authorization') || '';
    const isApiKeyAuth = authHeader.startsWith(`Bearer ${API_KEY_PREFIX}`);
    let rateLimitKey: string;
    let rateLimitConfig = undefined;

    if (isApiKeyAuth) {
      // Extract prefix for rate limiting (e.g., "cliaas_ab12cd34")
      const rawKey = authHeader.replace(/^Bearer\s+/i, '');
      rateLimitKey = `apikey:${rawKey.slice(0, API_KEY_PREFIX.length + 8)}`;
      rateLimitConfig = API_KEY_RATE_LIMIT;
    } else {
      rateLimitKey = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || 'unknown';
    }

    const result = checkRateLimit(rateLimitKey, rateLimitConfig);
    if (!result.allowed) {
      const rateLimitResponse = NextResponse.json(
        { error: 'Too many requests', retryAfter: result.retryAfter },
        { status: 429 }
      );
      const rlHeaders = getRateLimitHeaders(result, rateLimitConfig);
      for (const [key, value] of Object.entries(rlHeaders)) {
        rateLimitResponse.headers.set(key, value);
      }
      applySecurityHeaders(rateLimitResponse);
      return rateLimitResponse;
    }
  }

  // Allow public routes (with cleaned headers)
  if (isPublic(pathname)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    applySecurityHeaders(response);
    return response;
  }

  // In demo mode (no DB), skip auth entirely
  if (!process.env.DATABASE_URL) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    applySecurityHeaders(response);
    return response;
  }

  // API key bearer token passthrough — defer validation to route handler
  const authorizationHeader = requestHeaders.get('authorization') || '';
  if (authorizationHeader.startsWith(`Bearer ${API_KEY_PREFIX}`)) {
    requestHeaders.set('x-auth-type', 'api-key');
    const response = NextResponse.next({ request: { headers: requestHeaders } });
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
    // Reject intermediate MFA tokens — they cannot be used as full sessions
    if (payload.mfaPending) {
      if (isApiRoute) {
        const response = NextResponse.json(
          { error: 'MFA verification required' },
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
    // Attach user info as headers for downstream use
    requestHeaders.set('x-user-id', payload.id as string);
    requestHeaders.set('x-workspace-id', payload.workspaceId as string);
    requestHeaders.set('x-user-role', (payload.role as string) || '');
    requestHeaders.set('x-user-email', (payload.email as string) || '');
    if (payload.tenantId) {
      requestHeaders.set('x-tenant-id', payload.tenantId as string);
    }
    const response = NextResponse.next({ request: { headers: requestHeaders } });
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
