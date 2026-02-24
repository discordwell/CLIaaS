import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { PLANS, getPlanQuotas } from '@/lib/billing/plans';
import { getCurrentUsage } from '@/lib/billing/usage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  // Demo mode: return mock billing data
  if (!process.env.DATABASE_URL) {
    const plan = PLANS.founder;
    return NextResponse.json({
      plan: plan.id,
      planName: plan.name,
      price: plan.price,
      quotas: plan.quotas,
      usage: { ticketsCreated: 0, aiCallsMade: 0, apiRequestsMade: 0, period: '' },
      subscription: null,
    });
  }

  const { db } = await import('@/db');
  const { tenants } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const tenantId = auth.user.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant associated' }, { status: 400 });
  }

  const [tenant] = await db
    .select({
      plan: tenants.plan,
      stripeSubscriptionId: tenants.stripeSubscriptionId,
      stripeSubscriptionStatus: tenants.stripeSubscriptionStatus,
      currentPeriodEnd: tenants.currentPeriodEnd,
      cancelAtPeriodEnd: tenants.cancelAtPeriodEnd,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const plan = PLANS[tenant.plan] ?? PLANS.free;
  const quotas = getPlanQuotas(tenant.plan);
  const usage = await getCurrentUsage(tenantId);

  return NextResponse.json({
    plan: plan.id,
    planName: plan.name,
    price: plan.price,
    quotas,
    usage,
    subscription: tenant.stripeSubscriptionId
      ? {
          id: tenant.stripeSubscriptionId,
          status: tenant.stripeSubscriptionStatus,
          currentPeriodEnd: tenant.currentPeriodEnd,
          cancelAtPeriodEnd: tenant.cancelAtPeriodEnd,
        }
      : null,
  });
}
