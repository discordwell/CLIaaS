import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { createSession, cleanupExpiredSessions } from '@/lib/channels/sdk-session';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limiter';

export const dynamic = 'force-dynamic';

// Rate limit: 30 session inits per minute per IP
const SDK_INIT_RATE_LIMIT = { windowMs: 60_000, maxRequests: 30 };

export async function POST(request: NextRequest) {
  // Rate limit by IP
  const clientIp = request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',').pop()?.trim()
    || 'unknown';
  const rateResult = checkRateLimit(`sdk-init:${clientIp}`, SDK_INIT_RATE_LIMIT);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: getRateLimitHeaders(rateResult, SDK_INIT_RATE_LIMIT) },
    );
  }

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  // Periodically clean up expired sessions
  cleanupExpiredSessions();

  try {
    const { workspaceId, customer } = parsed.data as {
      workspaceId?: string;
      customer?: { name?: string; email?: string; customAttributes?: Record<string, unknown> };
    };

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId is required' },
        { status: 400 },
      );
    }

    // Generate a customerId from customer info or create an anonymous one
    const customerId = customer?.email
      ? `sdk-${Buffer.from(customer.email).toString('base64url').slice(0, 16)}`
      : `sdk-anon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const session = createSession(workspaceId, customerId);

    return NextResponse.json(
      {
        sessionId: session.id,
        customerId: session.customerId,
        token: session.token,
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create session' },
      { status: 500 },
    );
  }
}
