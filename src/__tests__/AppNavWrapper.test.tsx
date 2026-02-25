/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock next/navigation before any imports
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}));

// Mock the child nav components
vi.mock('@/components/AppNav', () => ({
  default: () => <div data-testid="app-nav">AppNav</div>,
}));
vi.mock('@/components/PublicNav', () => ({
  default: () => <div data-testid="public-nav">PublicNav</div>,
}));

import { render } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import AppNavWrapper from '@/components/AppNavWrapper';

describe('AppNavWrapper', () => {
  const mockUsePathname = usePathname as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset document.cookie
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: '',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows AppNav on /docs when cliaas-logged-in cookie is set', () => {
    mockUsePathname.mockReturnValue('/docs');
    document.cookie = 'cliaas-logged-in=1';
    const { getByTestId } = render(<AppNavWrapper />);
    expect(getByTestId('app-nav')).toBeTruthy();
  });

  it('shows PublicNav on /docs when cliaas-logged-in cookie is absent', () => {
    mockUsePathname.mockReturnValue('/docs');
    document.cookie = '';
    const { getByTestId } = render(<AppNavWrapper />);
    expect(getByTestId('public-nav')).toBeTruthy();
  });

  it('does NOT check for cliaas-session cookie (httpOnly, invisible to JS)', () => {
    mockUsePathname.mockReturnValue('/docs');
    document.cookie = 'cliaas-session=some-jwt-token';
    const { getByTestId } = render(<AppNavWrapper />);
    // Should show PublicNav because the wrapper only checks cliaas-logged-in
    expect(getByTestId('public-nav')).toBeTruthy();
  });

  it('returns null for sign-in page', () => {
    mockUsePathname.mockReturnValue('/sign-in');
    const { container } = render(<AppNavWrapper />);
    expect(container.innerHTML).toBe('');
  });

  it('shows AppNav for authenticated app routes', () => {
    mockUsePathname.mockReturnValue('/dashboard');
    const { getByTestId } = render(<AppNavWrapper />);
    expect(getByTestId('app-nav')).toBeTruthy();
  });
});
