import {
  isFeatureEnabled,
  getTierForTenant,
  getMinimumTier,
  FEATURE_LABELS,
  TIER_LABELS,
} from '@/lib/features';
import type { Feature } from '@/lib/features';

interface FeatureGateProps {
  feature: Feature;
  children: React.ReactNode;
  tenantId?: string;
}

/**
 * Server component that gates premium page content by feature + tenant tier.
 *
 * If the tenant's tier includes the requested feature, children are rendered.
 * Otherwise an upgrade prompt card is shown.
 */
export default async function FeatureGate({
  feature,
  children,
  tenantId,
}: FeatureGateProps) {
  const tier = tenantId ? await getTierForTenant(tenantId) : 'byoc';

  if (isFeatureEnabled(feature, tier)) {
    return <>{children}</>;
  }

  const requiredTier = getMinimumTier(feature);
  const featureLabel = FEATURE_LABELS[feature];
  const tierLabel = TIER_LABELS[requiredTier];

  return (
    <div className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      <section className="border-2 border-zinc-950 bg-white p-8">
        <div className="text-center">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            Premium Feature
          </p>
          <h2 className="mt-4 text-2xl font-bold">{featureLabel}</h2>
          <p className="mt-2 text-sm text-zinc-600">
            This feature is available on the{' '}
            <span className="font-bold">{tierLabel}</span> plan and above.
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Your current plan:{' '}
            <span className="font-mono font-bold">{TIER_LABELS[tier]}</span>
          </p>
          <a
            href="/billing"
            className="mt-6 inline-block border-2 border-zinc-950 bg-zinc-950 px-6 py-3 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            Upgrade Plan
          </a>
        </div>
      </section>
    </div>
  );
}
