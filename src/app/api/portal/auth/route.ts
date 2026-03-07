import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadTickets } from '@/lib/data';
import { generateToken } from '@/lib/portal/magic-link';
import { sendMagicLink } from '@/lib/portal/send-magic-link';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { validateEmail } from '@/lib/email-validation';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limiter';

export const dynamic = 'force-dynamic';

// Rate limit configs
const EMAIL_RATE_LIMIT = { windowMs: 5 * 60_000, maxRequests: 3 };
const IP_RATE_LIMIT = { windowMs: 15 * 60_000, maxRequests: 10 };

/** Extract client IP from proxy headers.
 *  Prefers x-real-ip (set by Caddy/Nginx from actual connection).
 *  Falls back to last entry of x-forwarded-for (appended by trusted proxy). */
export function getClientIp(request: NextRequest): string {
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',');
    return parts[parts.length - 1].trim();
  }
  return 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    // IP-level rate limit (10 requests per 15 min)
    const clientIp = getClientIp(request);
    const ipLimit = checkRateLimit(`magic-link:ip:${clientIp}`, IP_RATE_LIMIT);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: getRateLimitHeaders(ipLimit, IP_RATE_LIMIT) }
      );
    }

    const parsed = await parseJsonBody<{ email?: string }>(request);
    if ('error' in parsed) return parsed.error;
    const { email } = parsed.data;

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const emailCheck = validateEmail(email);
    if (!emailCheck.valid) {
      return NextResponse.json(
        { error: emailCheck.reason },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Per-email rate limit (3 requests per 5 min)
    const emailLimit = checkRateLimit(`magic-link:email:${normalizedEmail}`, EMAIL_RATE_LIMIT);
    if (!emailLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests for this email. Please try again later.' },
        { status: 429, headers: getRateLimitHeaders(emailLimit, EMAIL_RATE_LIMIT) }
      );
    }

    // Check if the customer exists in the DB
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        await db
          .select({ id: schema.customers.id, email: schema.customers.email })
          .from(schema.customers)
          .where(eq(schema.customers.email, normalizedEmail))
          .limit(1);
      } catch {
        // DB unavailable, fall through to JSONL
      }
    }

    // Generate a magic-link token
    const token = generateToken(normalizedEmail);

    // In production, send email with the verification link.
    // For now, return the token and a link for dev/demo use.
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    const verifyUrl = `${baseUrl}/api/portal/auth/verify?token=${token.token}`;

    // Send the magic link (logs in dev, emails in production)
    await sendMagicLink(normalizedEmail, verifyUrl);

    // Check if the email has tickets for the response
    const tickets = await loadTickets();
    const hasTickets = tickets.some(
      (t) => t.requester.toLowerCase() === normalizedEmail
    );

    const isDev = process.env.NODE_ENV !== 'production';

    return NextResponse.json({
      ok: true,
      email: normalizedEmail,
      hasTickets,
      // Only expose verifyUrl and token in dev mode
      ...(isDev && { verifyUrl }),
      ...(isDev && { token: token.token }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Authentication failed') },
      { status: 500 }
    );
  }
}
