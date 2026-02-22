import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadTickets } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const { email } = body as { email?: string };

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

        const customers = await db
          .select({ id: schema.customers.id, email: schema.customers.email })
          .from(schema.customers)
          .where(eq(schema.customers.email, normalizedEmail))
          .limit(1);

        if (customers.length === 0) {
          // Still allow access -- they might want to create a ticket
        }
      } catch {
        // DB unavailable, fall through to JSONL
      }
    }

    // For JSONL/demo mode, check if the email appears as a requester
    const tickets = await loadTickets();
    const hasTickets = tickets.some(
      (t) => t.requester.toLowerCase() === normalizedEmail
    );

    // Set the portal email cookie
    const response = NextResponse.json({
      ok: true,
      email: normalizedEmail,
      hasTickets,
    });

    response.cookies.set('cliaas-portal-email', normalizedEmail, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    });

    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Authentication failed' },
      { status: 500 }
    );
  }
}
