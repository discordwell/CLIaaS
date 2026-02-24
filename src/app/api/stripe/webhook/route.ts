import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const logger = createLogger('stripe-webhook');

export async function POST(request: Request) {
  const stripe = await getStripeClient();
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error('STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
  }

  const sig = request.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event;
  try {
    const rawBody = await request.text();
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature';
    logger.warn({ error: message }, 'Webhook signature verification failed');
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 });
  }

  // Process the event
  try {
    await handleStripeEvent(event);
  } catch (err) {
    logger.error({ error: err, eventType: event.type }, 'Webhook handler error');
    // Still return 200 to Stripe so it doesn't retry
  }

  return NextResponse.json({ received: true });
}

async function getStripeClient() {
  const { getStripe } = await import('@/lib/billing/stripe');
  return getStripe();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleStripeEvent(event: { id: string; type: string; data: { object: any } }) {
  if (!process.env.DATABASE_URL) return;

  const { db } = await import('@/db');
  const { tenants, billingEvents } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  // Idempotency: skip if we already processed this event
  const [existing] = await db
    .select({ id: billingEvents.id })
    .from(billingEvents)
    .where(eq(billingEvents.stripeEventId, event.id))
    .limit(1);

  if (existing) {
    logger.info({ eventId: event.id }, 'Duplicate event, skipping');
    return;
  }

  const obj = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      const tenantId = (obj.metadata as Record<string, string>)?.tenantId;
      const subscriptionId = obj.subscription as string;
      if (tenantId && subscriptionId) {
        // Resolve plan from the subscription's price
        let plan: string | undefined;
        try {
          const stripe = (await import('@/lib/billing/stripe')).getStripe();
          if (stripe) {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            const priceId = sub.items.data[0]?.price?.id;
            if (priceId === process.env.STRIPE_PRICE_PRO_HOSTED) plan = 'pro_hosted';
            else if (priceId === process.env.STRIPE_PRICE_PRO) plan = 'pro';
            // Legacy
            else if (priceId === process.env.STRIPE_PRICE_STARTER) plan = 'starter';
          }
        } catch {
          logger.warn({ subscriptionId }, 'Could not resolve plan from subscription');
        }
        await db
          .update(tenants)
          .set({
            stripeSubscriptionId: subscriptionId,
            stripeSubscriptionStatus: 'active',
            ...(plan ? { plan } : {}),
          })
          .where(eq(tenants.id, tenantId));
        logger.info({ tenantId, subscriptionId, plan }, 'Checkout completed');
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subId = obj.id as string;
      const status = obj.status as string;
      const periodEnd = obj.current_period_end as number;
      const cancelAt = obj.cancel_at_period_end as boolean;

      // Find tenant by subscription ID
      const [tenant] = await db
        .select({ id: tenants.id, plan: tenants.plan })
        .from(tenants)
        .where(eq(tenants.stripeSubscriptionId, subId))
        .limit(1);

      if (tenant) {
        // Map subscription to plan based on price
        const items = (obj.items as { data?: Array<{ price?: { id?: string } }> })?.data;
        const priceId = items?.[0]?.price?.id;
        let plan = tenant.plan;
        if (priceId === process.env.STRIPE_PRICE_PRO_HOSTED) plan = 'pro_hosted';
        else if (priceId === process.env.STRIPE_PRICE_PRO) plan = 'pro';
        // Legacy
        else if (priceId === process.env.STRIPE_PRICE_STARTER) plan = 'starter';

        await db
          .update(tenants)
          .set({
            plan,
            stripeSubscriptionStatus: status,
            currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
            cancelAtPeriodEnd: cancelAt,
          })
          .where(eq(tenants.id, tenant.id));
        logger.info({ tenantId: tenant.id, status, plan }, 'Subscription updated');
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subId = obj.id as string;
      const [tenant] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.stripeSubscriptionId, subId))
        .limit(1);

      if (tenant) {
        await db
          .update(tenants)
          .set({
            plan: 'byoc',
            stripeSubscriptionStatus: 'canceled',
            cancelAtPeriodEnd: false,
          })
          .where(eq(tenants.id, tenant.id));
        logger.info({ tenantId: tenant.id }, 'Subscription deleted, reverted to byoc');
      }
      break;
    }

    case 'invoice.payment_failed': {
      const subId = obj.subscription as string;
      if (subId) {
        const [tenant] = await db
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.stripeSubscriptionId, subId))
          .limit(1);

        if (tenant) {
          await db
            .update(tenants)
            .set({ stripeSubscriptionStatus: 'past_due' })
            .where(eq(tenants.id, tenant.id));
          logger.warn({ tenantId: tenant.id }, 'Payment failed');
        }
      }
      break;
    }
  }

  // Record the event for idempotency and audit
  const tenantId = extractTenantId(event);
  await db.insert(billingEvents).values({
    tenantId,
    eventType: event.type,
    stripeEventId: event.id,
    payload: event.data.object,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTenantId(event: { data: { object: any } }): string | null {
  const obj = event.data.object;
  const metadata = obj.metadata as Record<string, string> | undefined;
  return metadata?.tenantId ?? null;
}
