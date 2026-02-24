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
  it('returns true for byoc on all features', () => {
    const features = Object.keys(FEATURE_MATRIX) as Feature[];
    for (const feature of features) {
      expect(isFeatureEnabled(feature, 'byoc')).toBe(true);
    }
  });

  it('returns false for free tier on premium features', () => {
    expect(isFeatureEnabled('analytics', 'free')).toBe(false);
    expect(isFeatureEnabled('ai_dashboard', 'free')).toBe(false);
    expect(isFeatureEnabled('sandbox', 'free')).toBe(false);
    expect(isFeatureEnabled('sso', 'free')).toBe(false);
    expect(isFeatureEnabled('compliance', 'free')).toBe(false);
  });

  it('returns true for founder tier on analytics', () => {
    expect(isFeatureEnabled('analytics', 'founder')).toBe(true);
  });

  it('returns true for enterprise on all features', () => {
    const features = Object.keys(FEATURE_MATRIX) as Feature[];
    for (const feature of features) {
      expect(isFeatureEnabled(feature, 'enterprise')).toBe(true);
    }
  });

  it('returns true for pro tier on compliance and sandbox', () => {
    expect(isFeatureEnabled('compliance', 'pro')).toBe(true);
    expect(isFeatureEnabled('sandbox', 'pro')).toBe(true);
  });

  it('returns false for starter tier on sso', () => {
    expect(isFeatureEnabled('sso', 'starter')).toBe(false);
  });

  it('returns true for starter tier on voice_channels', () => {
    expect(isFeatureEnabled('voice_channels', 'starter')).toBe(true);
  });

  it('returns true for starter tier on social_channels', () => {
    expect(isFeatureEnabled('social_channels', 'starter')).toBe(true);
  });
});

describe('getAvailableFeatures', () => {
  it('returns no features for free tier', () => {
    const features = getAvailableFeatures('free');
    expect(features).toEqual([]);
  });

  it('returns all features for byoc tier', () => {
    const features = getAvailableFeatures('byoc');
    const allFeatures = Object.keys(FEATURE_MATRIX) as Feature[];
    expect(features).toEqual(allFeatures);
  });

  it('returns all features for enterprise tier', () => {
    const features = getAvailableFeatures('enterprise');
    const allFeatures = Object.keys(FEATURE_MATRIX) as Feature[];
    expect(features).toEqual(allFeatures);
  });

  it('returns correct subset for starter tier', () => {
    const features = getAvailableFeatures('starter');
    expect(features).toContain('analytics');
    expect(features).toContain('sla_management');
    expect(features).toContain('voice_channels');
    expect(features).toContain('social_channels');
    expect(features).not.toContain('sso');
    expect(features).not.toContain('sandbox');
    expect(features).not.toContain('compliance');
  });

  it('returns correct subset for founder tier', () => {
    const features = getAvailableFeatures('founder');
    expect(features).toContain('analytics');
    expect(features).toContain('ai_dashboard');
    expect(features).toContain('sla_management');
    expect(features).not.toContain('sso');
    expect(features).not.toContain('sandbox');
  });

  it('returns correct subset for pro tier', () => {
    const features = getAvailableFeatures('pro');
    expect(features).toContain('analytics');
    expect(features).toContain('ai_dashboard');
    expect(features).toContain('advanced_automation');
    expect(features).toContain('compliance');
    expect(features).toContain('sandbox');
    expect(features).toContain('custom_branding');
    expect(features).not.toContain('sso');
  });
});

describe('getMinimumTier', () => {
  it('returns founder for analytics (first hosted tier with access)', () => {
    expect(getMinimumTier('analytics')).toBe('founder');
  });

  it('returns founder for ai_dashboard', () => {
    expect(getMinimumTier('ai_dashboard')).toBe('founder');
  });

  it('returns pro for sandbox', () => {
    expect(getMinimumTier('sandbox')).toBe('pro');
  });

  it('returns enterprise for sso', () => {
    expect(getMinimumTier('sso')).toBe('enterprise');
  });

  it('returns starter for voice_channels', () => {
    expect(getMinimumTier('voice_channels')).toBe('starter');
  });

  it('returns pro for compliance', () => {
    expect(getMinimumTier('compliance')).toBe('pro');
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
    const tiers: TierLevel[] = ['byoc', 'free', 'founder', 'starter', 'pro', 'enterprise'];
    for (const tier of tiers) {
      expect(TIER_LABELS[tier]).toBeDefined();
      expect(typeof TIER_LABELS[tier]).toBe('string');
    }
  });
});
