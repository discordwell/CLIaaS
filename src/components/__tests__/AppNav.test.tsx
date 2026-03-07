// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock EventSource for SSE features (NotificationBell)
if (typeof globalThis.EventSource === 'undefined') {
  (globalThis as Record<string, unknown>).EventSource = class {
    onmessage = null;
    onerror = null;
    close() {}
    addEventListener() {}
    removeEventListener() {}
  };
}

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

  it('renders the essential navigation links', () => {
    render(<AppNav />);
    const expectedLabels = ['Dashboard', 'Tickets', 'Chat', 'AI'];
    for (const label of expectedLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders the command palette trigger', () => {
    render(<AppNav />);
    expect(screen.getByTitle('Command palette (⌘K)')).toBeInTheDocument();
  });

  it('renders correct hrefs for nav links', () => {
    render(<AppNav />);
    const dashboardLink = screen.getByText('Dashboard').closest('a');
    expect(dashboardLink).toHaveAttribute('href', '/dashboard');

    const chatLink = screen.getByText('Chat').closest('a');
    expect(chatLink).toHaveAttribute('href', '/chat');

    const aiLink = screen.getByText('AI').closest('a');
    expect(aiLink).toHaveAttribute('href', '/ai');
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
    mockedUsePathname.mockReturnValue('/ai/setup');
    render(<AppNav />);
    const aiLink = screen.getByText('AI').closest('a');
    expect(aiLink?.className).toContain('bg-zinc-950');
    expect(aiLink?.className).toContain('text-white');
  });

  it('does not highlight inactive nav links', () => {
    mockedUsePathname.mockReturnValue('/dashboard');
    render(<AppNav />);
    const chatLink = screen.getByText('Chat').closest('a');
    expect(chatLink?.className).toContain('text-zinc-500');
    expect(chatLink?.className).not.toContain('bg-zinc-950 text-white');
  });
});
