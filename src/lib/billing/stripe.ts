/**
 * Stripe client singleton and customer management.
 */

import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

/**
 * Get the Stripe client singleton. Returns null if STRIPE_SECRET_KEY is not configured.
 */
export function getStripe(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!stripeInstance) {
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeInstance;
}

/**
 * Get or create a Stripe customer for a tenant.
 * Returns the Stripe customer ID, or null if Stripe is not configured.
 */
export async function getOrCreateCustomer(
  tenantId: string,
  email: string,
  name: string,
): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  // Check if tenant already has a Stripe customer ID
  const { db } = await import('@/db');
  const { tenants } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const [tenant] = await db
    .select({ stripeCustomerId: tenants.stripeCustomerId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (tenant?.stripeCustomerId) return tenant.stripeCustomerId;

  // Create a new Stripe customer
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { tenantId },
  });

  // Store the customer ID
  await db
    .update(tenants)
    .set({ stripeCustomerId: customer.id })
    .where(eq(tenants.id, tenantId));

  return customer.id;
}
