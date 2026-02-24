// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the features module
vi.mock('@/lib/features', () => ({
  isFeatureEnabled: vi.fn(),
  getTierForTenant: vi.fn(),
  getMinimumTier: vi.fn(),
  FEATURE_LABELS: {
    analytics: 'Analytics Dashboard',
    ai_dashboard: 'AI Dashboard',
    advanced_automation: 'Advanced Automation',
    sla_management: 'SLA Management',
    compliance: 'Compliance & GDPR',
    sandbox: 'Sandbox Environments',
    voice_channels: 'Voice Channels',
    social_channels: 'Social Channels',
    sso: 'Single Sign-On (SSO)',
    custom_branding: 'Custom Branding',
  },
  TIER_LABELS: {
    byoc: 'BYOC',
    pro: 'Pro',
    pro_hosted: 'Pro Hosted',
    enterprise: 'Enterprise',
    basic: 'BYOC',
    free: 'BYOC',
    founder: 'BYOC',
    starter: 'BYOC',
  },
}));

import FeatureGate from '../FeatureGate';
import { isFeatureEnabled, getTierForTenant, getMinimumTier } from '@/lib/features';

const mockedIsFeatureEnabled = vi.mocked(isFeatureEnabled);
const mockedGetTierForTenant = vi.mocked(getTierForTenant);
const mockedGetMinimumTier = vi.mocked(getMinimumTier);

describe('FeatureGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetTierForTenant.mockResolvedValue('byoc');
    mockedGetMinimumTier.mockReturnValue('enterprise');
  });

  it('renders children when feature is enabled (byoc default)', async () => {
    mockedIsFeatureEnabled.mockReturnValue(true);

    const Component = await FeatureGate({
      feature: 'analytics',
      children: <div>Analytics Content</div>,
    });

    render(<>{Component}</>);
    expect(screen.getByText('Analytics Content')).toBeInTheDocument();
  });

  it('renders upgrade prompt when feature is disabled', async () => {
    mockedIsFeatureEnabled.mockReturnValue(false);
    mockedGetMinimumTier.mockReturnValue('enterprise');

    const Component = await FeatureGate({
      feature: 'sso',
      children: <div>SSO Content</div>,
    });

    render(<>{Component}</>);

    // Should NOT render children
    expect(screen.queryByText('SSO Content')).not.toBeInTheDocument();

    // Should show upgrade prompt
    expect(screen.getByText('Premium Feature')).toBeInTheDocument();
    expect(screen.getByText('Single Sign-On (SSO)')).toBeInTheDocument();
    expect(screen.getByText('Upgrade Plan')).toBeInTheDocument();
  });

  it('shows the required tier in upgrade prompt', async () => {
    mockedIsFeatureEnabled.mockReturnValue(false);
    mockedGetMinimumTier.mockReturnValue('enterprise');

    const Component = await FeatureGate({
      feature: 'sso',
      children: <div>SSO Content</div>,
    });

    render(<>{Component}</>);

    expect(screen.getByText('Enterprise')).toBeInTheDocument();
    expect(screen.getByText('Single Sign-On (SSO)')).toBeInTheDocument();
  });

  it('resolves tenant tier when tenantId is provided', async () => {
    mockedGetTierForTenant.mockResolvedValue('byoc');
    mockedIsFeatureEnabled.mockReturnValue(true);

    const Component = await FeatureGate({
      feature: 'analytics',
      children: <div>Analytics Content</div>,
      tenantId: 'tenant-123',
    });

    render(<>{Component}</>);

    expect(mockedGetTierForTenant).toHaveBeenCalledWith('tenant-123');
    expect(screen.getByText('Analytics Content')).toBeInTheDocument();
  });

  it('defaults to byoc tier when no tenantId is provided', async () => {
    mockedIsFeatureEnabled.mockReturnValue(true);

    const Component = await FeatureGate({
      feature: 'analytics',
      children: <div>Content</div>,
    });

    render(<>{Component}</>);

    expect(mockedGetTierForTenant).not.toHaveBeenCalled();
    expect(mockedIsFeatureEnabled).toHaveBeenCalledWith('analytics', 'byoc');
  });

  it('shows current plan in upgrade prompt', async () => {
    mockedGetTierForTenant.mockResolvedValue('byoc');
    mockedIsFeatureEnabled.mockReturnValue(false);
    mockedGetMinimumTier.mockReturnValue('enterprise');

    const Component = await FeatureGate({
      feature: 'sso',
      children: <div>SSO Content</div>,
      tenantId: 'tenant-456',
    });

    render(<>{Component}</>);

    expect(screen.getByText('BYOC')).toBeInTheDocument();
  });

  it('upgrade link points to /billing', async () => {
    mockedIsFeatureEnabled.mockReturnValue(false);
    mockedGetMinimumTier.mockReturnValue('enterprise');

    const Component = await FeatureGate({
      feature: 'sso',
      children: <div>Content</div>,
    });

    render(<>{Component}</>);

    const link = screen.getByText('Upgrade Plan');
    expect(link.closest('a')).toHaveAttribute('href', '/billing');
  });
});
