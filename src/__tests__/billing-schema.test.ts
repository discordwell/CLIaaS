import { describe, it, expect } from 'vitest';
import * as schema from '@/db/schema';

describe('Billing schema tables', () => {
  it('exports tenants table with Stripe fields', () => {
    expect(schema.tenants).toBeDefined();
    const cols = schema.tenants;
    expect(cols.stripeCustomerId).toBeDefined();
    expect(cols.stripeSubscriptionId).toBeDefined();
    expect(cols.stripeSubscriptionStatus).toBeDefined();
    expect(cols.currentPeriodEnd).toBeDefined();
    expect(cols.cancelAtPeriodEnd).toBeDefined();
  });

  it('exports usage_metrics table with expected columns', () => {
    expect(schema.usageMetrics).toBeDefined();
    const cols = schema.usageMetrics;
    expect(cols.tenantId).toBeDefined();
    expect(cols.period).toBeDefined();
    expect(cols.ticketsCreated).toBeDefined();
    expect(cols.aiCallsMade).toBeDefined();
    expect(cols.apiRequestsMade).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });

  it('exports billing_events table with expected columns', () => {
    expect(schema.billingEvents).toBeDefined();
    const cols = schema.billingEvents;
    expect(cols.tenantId).toBeDefined();
    expect(cols.eventType).toBeDefined();
    expect(cols.stripeEventId).toBeDefined();
    expect(cols.payload).toBeDefined();
    expect(cols.createdAt).toBeDefined();
  });
});
