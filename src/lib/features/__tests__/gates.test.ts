import { describe, it, expect } from 'vitest';
import {
  isFeatureEnabled,
  getAvailableFeatures,
  getMinimumTier,
  FEATURE_MATRIX,
  FEATURE_LABELS,
  TIER_LABELS,
} from '../gates';
import type { Feature, TierLevel } from '../gates';

describe('isFeatureEnabled', () => {
  const ENTERPRISE_ONLY: Feature[] = ['sso', 'multi_brand'];

  it('returns true for byoc on all features except enterprise-only ones', () => {
    const features = Object.keys(FEATURE_MATRIX) as Feature[];
    for (const feature of features) {
      if (ENTERPRISE_ONLY.includes(feature)) {
        expect(isFeatureEnabled(feature, 'byoc')).toBe(false);
      } else {
        expect(isFeatureEnabled(feature, 'byoc')).toBe(true);
      }
    }
  });

  it('returns true for all legacy tiers on broadly-available features', () => {
    const legacyTiers: TierLevel[] = ['basic', 'free', 'founder', 'starter'];
    for (const tier of legacyTiers) {
      expect(isFeatureEnabled('analytics', tier)).toBe(true);
      expect(isFeatureEnabled('ai_dashboard', tier)).toBe(true);
      expect(isFeatureEnabled('sandbox', tier)).toBe(true);
      expect(isFeatureEnabled('compliance', tier)).toBe(true);
    }
  });

  it('legacy tiers do not get answer_bot', () => {
    const legacyTiers: TierLevel[] = ['basic', 'free', 'founder', 'starter'];
    for (const tier of legacyTiers) {
      expect(isFeatureEnabled('answer_bot', tier)).toBe(false);
    }
  });

  it('sso and multi_brand are enterprise-only', () => {
    for (const feature of ENTERPRISE_ONLY) {
      expect(isFeatureEnabled(feature, 'enterprise')).toBe(true);
      expect(isFeatureEnabled(feature, 'byoc')).toBe(false);
      expect(isFeatureEnabled(feature, 'pro')).toBe(false);
      expect(isFeatureEnabled(feature, 'pro_hosted')).toBe(false);
      expect(isFeatureEnabled(feature, 'basic')).toBe(false);
    }
  });

  it('returns true for enterprise on all features', () => {
    const features = Object.keys(FEATURE_MATRIX) as Feature[];
    for (const feature of features) {
      expect(isFeatureEnabled(feature, 'enterprise')).toBe(true);
    }
  });

  it('returns true for pro_hosted on all features except enterprise-only and byoc-only ones', () => {
    const features = Object.keys(FEATURE_MATRIX) as Feature[];
    const NOT_PRO_HOSTED: Feature[] = [...ENTERPRISE_ONLY, 'hipaa_compliance'];
    for (const feature of features) {
      if (NOT_PRO_HOSTED.includes(feature)) {
        expect(isFeatureEnabled(feature, 'pro_hosted')).toBe(false);
      } else {
        expect(isFeatureEnabled(feature, 'pro_hosted')).toBe(true);
      }
    }
  });
});

describe('getAvailableFeatures', () => {
  const ENTERPRISE_ONLY: Feature[] = ['sso', 'multi_brand'];

  it('returns all features except enterprise-only for byoc tier', () => {
    const features = getAvailableFeatures('byoc');
    const allFeatures = Object.keys(FEATURE_MATRIX) as Feature[];
    expect(features).toEqual(allFeatures.filter(f => !ENTERPRISE_ONLY.includes(f)));
  });

  it('returns all features for enterprise tier', () => {
    const features = getAvailableFeatures('enterprise');
    const allFeatures = Object.keys(FEATURE_MATRIX) as Feature[];
    expect(features).toEqual(allFeatures);
  });

  it('returns correct features for legacy tiers (no sso, multi_brand, answer_bot, pii_masking, hipaa_compliance)', () => {
    const legacyTiers: TierLevel[] = ['basic', 'free', 'founder', 'starter'];
    const allFeatures = Object.keys(FEATURE_MATRIX) as Feature[];
    const excluded: Feature[] = ['sso', 'multi_brand', 'answer_bot', 'pii_masking', 'hipaa_compliance'];
    const expectedFeatures = allFeatures.filter(f => !excluded.includes(f));
    for (const tier of legacyTiers) {
      expect(getAvailableFeatures(tier)).toEqual(expectedFeatures);
    }
  });

  it('returns all features except enterprise-only for pro tier', () => {
    const features = getAvailableFeatures('pro');
    expect(features).toContain('analytics');
    expect(features).toContain('ai_dashboard');
    expect(features).toContain('sla_management');
    expect(features).toContain('voice_channels');
    expect(features).toContain('social_channels');
    expect(features).toContain('answer_bot');
    expect(features).not.toContain('sso');
    expect(features).not.toContain('multi_brand');
  });
});

describe('getMinimumTier', () => {
  it('returns byoc for most features', () => {
    expect(getMinimumTier('analytics')).toBe('byoc');
    expect(getMinimumTier('ai_dashboard')).toBe('byoc');
    expect(getMinimumTier('sandbox')).toBe('byoc');
    expect(getMinimumTier('compliance')).toBe('byoc');
    expect(getMinimumTier('voice_channels')).toBe('byoc');
  });

  it('returns enterprise for sso', () => {
    expect(getMinimumTier('sso')).toBe('enterprise');
  });
});

describe('FEATURE_LABELS', () => {
  it('has a label for every feature in the matrix', () => {
    const features = Object.keys(FEATURE_MATRIX) as Feature[];
    for (const feature of features) {
      expect(FEATURE_LABELS[feature]).toBeDefined();
      expect(typeof FEATURE_LABELS[feature]).toBe('string');
      expect(FEATURE_LABELS[feature].length).toBeGreaterThan(0);
    }
  });
});

describe('TIER_LABELS', () => {
  it('has a label for every tier', () => {
    const tiers: TierLevel[] = ['byoc', 'pro', 'pro_hosted', 'enterprise', 'basic', 'free', 'founder', 'starter'];
    for (const tier of tiers) {
      expect(TIER_LABELS[tier]).toBeDefined();
      expect(typeof TIER_LABELS[tier]).toBe('string');
    }
  });

  it('legacy tiers all display as BYOC', () => {
    expect(TIER_LABELS.basic).toBe('BYOC');
    expect(TIER_LABELS.free).toBe('BYOC');
    expect(TIER_LABELS.founder).toBe('BYOC');
    expect(TIER_LABELS.starter).toBe('BYOC');
  });
});
