/**
 * Feature gating matrix — maps features to the tier levels that unlock them.
 */

export type TierLevel =
  | 'byoc'
  | 'free'
  | 'founder'
  | 'starter'
  | 'pro'
  | 'enterprise';

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

/**
 * Which tiers have access to each feature.
 *
 * - byoc: local self-hosted, gets everything (customer owns infra)
 * - free: minimal GUI
 * - founder: generous early-adopter tier
 * - starter/pro/enterprise: paid hosted tiers
 */
export const FEATURE_MATRIX: Record<Feature, TierLevel[]> = {
  analytics:           ['byoc', 'founder', 'starter', 'pro', 'enterprise'],
  ai_dashboard:        ['byoc', 'founder', 'pro', 'enterprise'],
  advanced_automation: ['byoc', 'pro', 'enterprise'],
  sla_management:      ['byoc', 'founder', 'starter', 'pro', 'enterprise'],
  compliance:          ['byoc', 'pro', 'enterprise'],
  sandbox:             ['byoc', 'pro', 'enterprise'],
  voice_channels:      ['byoc', 'starter', 'pro', 'enterprise'],
  social_channels:     ['byoc', 'starter', 'pro', 'enterprise'],
  sso:                 ['byoc', 'enterprise'],
  custom_branding:     ['byoc', 'pro', 'enterprise'],
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
 * Tier ordering: free < founder < starter < pro < enterprise
 * (byoc is excluded since it is a special local mode)
 */
const TIER_ORDER: TierLevel[] = ['free', 'founder', 'starter', 'pro', 'enterprise'];

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
  byoc:       'BYOC',
  free:       'Free',
  founder:    'Founder',
  starter:    'Starter',
  pro:        'Pro',
  enterprise: 'Enterprise',
};
