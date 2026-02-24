/**
 * Stripe Checkout and Customer Portal session creation.
 */

import { getStripe, getOrCreateCustomer } from './stripe';

/**
 * Create a Stripe Checkout session for a plan upgrade.
 * Returns the session URL, or null if Stripe is not configured.
 */
export async function createCheckoutSession(opts: {
  tenantId: string;
  email: string;
  name: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const customerId = await getOrCreateCustomer(opts.tenantId, opts.email, opts.name);
  if (!customerId) return null;

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: opts.priceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    metadata: { tenantId: opts.tenantId },
  });

  return session.url;
}

/**
 * Create a Stripe Customer Portal session for subscription management.
 * Returns the portal URL, or null if Stripe is not configured.
 */
export async function createPortalSession(opts: {
  tenantId: string;
  email: string;
  name: string;
  returnUrl: string;
}): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const customerId = await getOrCreateCustomer(opts.tenantId, opts.email, opts.name);
  if (!customerId) return null;

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: opts.returnUrl,
  });

  return session.url;
}
