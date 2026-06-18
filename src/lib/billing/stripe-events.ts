/**
 * Helpers for reading fields off Stripe webhook event objects in a way that is
 * resilient to the field relocations introduced by the 2025+ ("clover") API.
 *
 * Two fields this app relies on moved between API versions:
 *
 *  - `Subscription.current_period_end` was removed from the Subscription object
 *    and now lives on each `SubscriptionItem` (`subscription.items.data[i]
 *    .current_period_end`).
 *  - `Invoice.subscription` was removed and now lives under
 *    `invoice.parent.subscription_details.subscription`.
 *
 * Webhook payloads are serialized using the *account's* API version (or the
 * version pinned to the webhook endpoint), which is not necessarily the SDK's
 * pinned version. These helpers therefore read the new location first and fall
 * back to the legacy top-level field, so both old and new payload shapes work.
 */

/**
 * Structural shape of the parts of a Stripe Subscription we read. These objects
 * arrive as `any` from the webhook payload and carry many more fields; only the
 * properties below are read.
 */
export interface SubscriptionPeriodSource {
  current_period_end?: number | null;
  items?: {
    data?: Array<{ current_period_end?: number | null }>;
  } | null;
}

/**
 * Resolve a subscription's current period end (unix seconds), reading from the
 * subscription item first (clover API) and falling back to the legacy
 * top-level field. Returns null when no positive timestamp is available.
 */
export function resolveSubscriptionPeriodEnd(sub: SubscriptionPeriodSource | null | undefined): number | null {
  if (!sub) return null;
  const itemEnd = sub.items?.data?.[0]?.current_period_end;
  const periodEnd = itemEnd ?? sub.current_period_end;
  return typeof periodEnd === 'number' && periodEnd > 0 ? periodEnd : null;
}

type SubscriptionRef = string | { id?: string | null } | null | undefined;

/** Structural shape of the parts of a Stripe Invoice we read. */
export interface InvoiceSubscriptionSource {
  subscription?: SubscriptionRef;
  parent?: {
    subscription_details?: {
      subscription?: SubscriptionRef;
    } | null;
  } | null;
}

/**
 * Resolve the subscription id referenced by an invoice, reading the clover
 * location (`parent.subscription_details.subscription`) and falling back to the
 * legacy top-level `subscription` field. Handles both string ids and expanded
 * Subscription objects. Returns null when the invoice has no subscription.
 */
export function resolveInvoiceSubscriptionId(invoice: InvoiceSubscriptionSource | null | undefined): string | null {
  if (!invoice) return null;
  const ref = invoice.parent?.subscription_details?.subscription ?? invoice.subscription;
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  return ref.id ?? null;
}
