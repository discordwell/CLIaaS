import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadTickets } from '@/lib/data';
import { generateToken } from '@/lib/portal/magic-link';
import { sendMagicLink } from '@/lib/portal/send-magic-link';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody<{ email?: string }>(request);
    if ('error' in parsed) return parsed.error;
    const { email } = parsed.data;

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'A valid email address is required' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

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
      { error: err instanceof Error ? err.message : 'Authentication failed' },
      { status: 500 }
    );
  }
}
