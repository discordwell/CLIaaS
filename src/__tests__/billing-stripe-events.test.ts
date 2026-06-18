import { describe, it, expect } from 'vitest';
import {
  resolveSubscriptionPeriodEnd,
  resolveInvoiceSubscriptionId,
} from '@/lib/billing/stripe-events';

/**
 * Regression coverage for the Stripe "clover" (2025+) API field relocations.
 *
 * The webhook handler previously read `subscription.current_period_end` and
 * `invoice.subscription` directly. Both fields were removed from the top level
 * in the clover API version (pinned by stripe@20.x — see node_modules/stripe/
 * cjs/apiVersion.js → 2026-01-28.clover), so the old reads returned undefined:
 *   - the tenant's renewal date was silently wiped to null on every update, and
 *   - failed payments never marked the tenant past_due.
 * These helpers read the new location first and fall back to the legacy field.
 */
describe('resolveSubscriptionPeriodEnd', () => {
  const PERIOD_END = 1_900_000_000; // a positive unix timestamp (year ~2030)

  it('reads current_period_end from the subscription item (clover API)', () => {
    // The exact shape that broke the old code: the field exists ONLY on the
    // item, so the legacy top-level read returned undefined → date wiped.
    const sub = {
      items: { data: [{ current_period_end: PERIOD_END }] },
    };
    expect(resolveSubscriptionPeriodEnd(sub)).toBe(PERIOD_END);
  });

  it('falls back to the legacy top-level current_period_end', () => {
    const sub = { current_period_end: PERIOD_END };
    expect(resolveSubscriptionPeriodEnd(sub)).toBe(PERIOD_END);
  });

  it('prefers the item value when both are present', () => {
    const sub = {
      current_period_end: 111,
      items: { data: [{ current_period_end: PERIOD_END }] },
    };
    expect(resolveSubscriptionPeriodEnd(sub)).toBe(PERIOD_END);
  });

  it('falls back to top-level when the item lacks a period end', () => {
    const sub = {
      current_period_end: PERIOD_END,
      items: { data: [{}] }, // item present but carries no period end
    };
    expect(resolveSubscriptionPeriodEnd(sub)).toBe(PERIOD_END);
  });

  it('returns null when no period end is available', () => {
    expect(resolveSubscriptionPeriodEnd({ items: { data: [] } })).toBeNull();
    expect(resolveSubscriptionPeriodEnd({})).toBeNull();
    expect(resolveSubscriptionPeriodEnd(null)).toBeNull();
    expect(resolveSubscriptionPeriodEnd(undefined)).toBeNull();
  });

  it('treats non-positive / non-numeric timestamps as null', () => {
    expect(resolveSubscriptionPeriodEnd({ current_period_end: 0 })).toBeNull();
    expect(resolveSubscriptionPeriodEnd({ current_period_end: -5 })).toBeNull();
    // @ts-expect-error — guarding against malformed payloads
    expect(resolveSubscriptionPeriodEnd({ current_period_end: 'soon' })).toBeNull();
  });
});

describe('resolveInvoiceSubscriptionId', () => {
  it('reads parent.subscription_details.subscription (clover API)', () => {
    // The shape that broke the old code: the id is no longer at the top level.
    const invoice = {
      parent: { subscription_details: { subscription: 'sub_abc' } },
    };
    expect(resolveInvoiceSubscriptionId(invoice)).toBe('sub_abc');
  });

  it('falls back to the legacy top-level subscription string', () => {
    expect(resolveInvoiceSubscriptionId({ subscription: 'sub_abc' })).toBe('sub_abc');
  });

  it('unwraps an expanded Subscription object at the clover location', () => {
    const invoice = {
      parent: { subscription_details: { subscription: { id: 'sub_abc' } } },
    };
    expect(resolveInvoiceSubscriptionId(invoice)).toBe('sub_abc');
  });

  it('unwraps an expanded Subscription object at the legacy location', () => {
    expect(resolveInvoiceSubscriptionId({ subscription: { id: 'sub_abc' } })).toBe('sub_abc');
  });

  it('returns null when the invoice has no subscription', () => {
    expect(resolveInvoiceSubscriptionId({})).toBeNull();
    expect(resolveInvoiceSubscriptionId({ parent: { subscription_details: null } })).toBeNull();
    expect(resolveInvoiceSubscriptionId({ parent: null })).toBeNull();
    expect(resolveInvoiceSubscriptionId(null)).toBeNull();
    expect(resolveInvoiceSubscriptionId(undefined)).toBeNull();
  });
});
