import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { createCheckoutSession } from '@/lib/billing/checkout';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

const PLAN_TO_PRICE_ENV: Record<string, string> = {
  starter: 'STRIPE_PRICE_STARTER',
  pro: 'STRIPE_PRICE_PRO',
};

export async function POST(request: Request) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{ plan: string }>(request);
  if ('error' in parsed) return parsed.error;

  const { plan } = parsed.data;
  if (!plan || !PLAN_TO_PRICE_ENV[plan]) {
    return NextResponse.json({ error: 'Invalid plan. Must be "starter" or "pro".' }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe is not configured' }, { status: 503 });
  }

  const priceId = process.env[PLAN_TO_PRICE_ENV[plan]];
  if (!priceId) {
    return NextResponse.json({ error: `Price not configured for ${plan} plan` }, { status: 503 });
  }

  const tenantId = auth.user.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant associated' }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const url = await createCheckoutSession({
    tenantId,
    email: auth.user.email,
    name: auth.user.name || auth.user.email,
    priceId,
    successUrl: `${baseUrl}/billing?success=true`,
    cancelUrl: `${baseUrl}/billing?canceled=true`,
  });

  if (!url) {
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }

  return NextResponse.json({ url });
}
