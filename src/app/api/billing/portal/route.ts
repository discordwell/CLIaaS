import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { createPortalSession } from '@/lib/billing/checkout';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe is not configured' }, { status: 503 });
  }

  const tenantId = auth.user.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant associated' }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const url = await createPortalSession({
    tenantId,
    email: auth.user.email,
    name: auth.user.name || auth.user.email,
    returnUrl: `${baseUrl}/billing`,
  });

  if (!url) {
    return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 });
  }

  return NextResponse.json({ url });
}
