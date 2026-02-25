// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/'),
  useRouter: vi.fn(() => ({ push: mockPush })),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import AppNav from '../AppNav';
import { usePathname } from 'next/navigation';

const mockedUsePathname = vi.mocked(usePathname);

describe('AppNav', () => {
  beforeEach(() => {
    mockedUsePathname.mockReturnValue('/');
    mockPush.mockClear();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}'));
  });

  it('renders the CLIaaS brand link', () => {
    render(<AppNav />);
    const brandLink = screen.getByText('CLIaaS');
    expect(brandLink).toBeInTheDocument();
    expect(brandLink.closest('a')).toHaveAttribute('href', '/');
  });

  it('renders all navigation links', () => {
    render(<AppNav />);
    const expectedLabels = [
      'Dashboard', 'Rules', 'Chat', 'Channels', 'AI',
      'Analytics', 'SLA', 'Integrations', 'Security', 'Enterprise', 'Billing', 'Docs',
    ];
    for (const label of expectedLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders correct hrefs for nav links', () => {
    render(<AppNav />);
    const dashboardLink = screen.getByText('Dashboard').closest('a');
    expect(dashboardLink).toHaveAttribute('href', '/dashboard');

    const rulesLink = screen.getByText('Rules').closest('a');
    expect(rulesLink).toHaveAttribute('href', '/rules');

    const docsLink = screen.getByText('Docs').closest('a');
    expect(docsLink).toHaveAttribute('href', '/docs');
  });

  it('renders a Sign Out button that calls signout API', async () => {
    render(<AppNav />);
    const signOut = screen.getByText('Sign Out');
    expect(signOut).toBeInTheDocument();
    expect(signOut.tagName).toBe('BUTTON');

    fireEvent.click(signOut);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/auth/signout', { method: 'POST' });
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('highlights the active nav link when pathname matches exactly', () => {
    mockedUsePathname.mockReturnValue('/dashboard');
    render(<AppNav />);
    const dashboardLink = screen.getByText('Dashboard').closest('a');
    expect(dashboardLink?.className).toContain('bg-zinc-950');
    expect(dashboardLink?.className).toContain('text-white');
  });

  it('highlights the active nav link for sub-routes', () => {
    mockedUsePathname.mockReturnValue('/rules/edit/123');
    render(<AppNav />);
    const rulesLink = screen.getByText('Rules').closest('a');
    expect(rulesLink?.className).toContain('bg-zinc-950');
    expect(rulesLink?.className).toContain('text-white');
  });

  it('does not highlight inactive nav links', () => {
    mockedUsePathname.mockReturnValue('/dashboard');
    render(<AppNav />);
    const rulesLink = screen.getByText('Rules').closest('a');
    expect(rulesLink?.className).toContain('text-zinc-500');
    expect(rulesLink?.className).not.toContain('bg-zinc-950 text-white');
  });
});
