/**
 * Feature gating matrix — maps features to the tier levels that unlock them.
 *
 * Tiers: byoc (free) → pro_hosted ($79) → enterprise (custom)
 * Legacy tiers (basic, free, founder, starter) all resolve like byoc.
 * SSO is enterprise-only. Everything else is available to all tiers.
 */

export type TierLevel =
  | 'byoc'
  | 'pro'
  | 'pro_hosted'
  | 'enterprise'
  // Legacy tier IDs still in DB for existing tenants
  | 'basic'
  | 'free'
  | 'founder'
  | 'starter';

export type Feature =
  | 'analytics'
  | 'ai_dashboard'
  | 'advanced_automation'
  | 'sla_management'
  | 'compliance'
  | 'sandbox'
  | 'voice_channels'
  | 'social_channels'
  | 'sso'
  | 'custom_branding';

/** All tiers (including legacy aliases). */
export const ALL_TIERS: TierLevel[] = [
  'byoc', 'pro', 'pro_hosted', 'enterprise',
  'basic', 'free', 'founder', 'starter',
];

/**
 * Which tiers have access to each feature.
 *
 * Everything is enabled for all tiers except SSO (enterprise only).
 */
export const FEATURE_MATRIX: Record<Feature, TierLevel[]> = {
  analytics:           [...ALL_TIERS],
  ai_dashboard:        [...ALL_TIERS],
  advanced_automation: [...ALL_TIERS],
  sla_management:      [...ALL_TIERS],
  compliance:          [...ALL_TIERS],
  sandbox:             [...ALL_TIERS],
  voice_channels:      [...ALL_TIERS],
  social_channels:     [...ALL_TIERS],
  sso:                 ['enterprise'],
  custom_branding:     [...ALL_TIERS],
};

/** Check whether a specific feature is enabled for a given tier. */
export function isFeatureEnabled(feature: Feature, tier: TierLevel): boolean {
  const allowed = FEATURE_MATRIX[feature];
  if (!allowed) return false;
  return allowed.includes(tier);
}

/** Return all features available for a given tier. */
export function getAvailableFeatures(tier: TierLevel): Feature[] {
  return (Object.keys(FEATURE_MATRIX) as Feature[]).filter((f) =>
    FEATURE_MATRIX[f].includes(tier),
  );
}

/**
 * Return the minimum tier required to unlock a feature.
 * Tier ordering: byoc < pro < pro_hosted < enterprise
 */
const TIER_ORDER: TierLevel[] = ['byoc', 'pro', 'pro_hosted', 'enterprise'];

export function getMinimumTier(feature: Feature): TierLevel {
  const allowed = FEATURE_MATRIX[feature];
  for (const tier of TIER_ORDER) {
    if (allowed.includes(tier)) return tier;
  }
  return 'enterprise';
}

/** Human-readable feature labels for upgrade prompts. */
export const FEATURE_LABELS: Record<Feature, string> = {
  analytics:           'Analytics Dashboard',
  ai_dashboard:        'AI Dashboard',
  advanced_automation: 'Advanced Automation',
  sla_management:      'SLA Management',
  compliance:          'Compliance & GDPR',
  sandbox:             'Sandbox Environments',
  voice_channels:      'Voice Channels',
  social_channels:     'Social Channels',
  sso:                 'Single Sign-On (SSO)',
  custom_branding:     'Custom Branding',
};

/** Human-readable tier labels. */
export const TIER_LABELS: Record<TierLevel, string> = {
  byoc:        'BYOC',
  pro:         'Pro',
  pro_hosted:  'Pro Hosted',
  enterprise:  'Enterprise',
  // Legacy
  basic:       'BYOC',
  free:        'BYOC',
  founder:     'BYOC',
  starter:     'BYOC',
};
