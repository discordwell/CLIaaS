// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/dashboard'),
  useRouter: vi.fn(() => ({ push: mockPush })),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import AppNavWrapper from '../AppNavWrapper';
import { usePathname } from 'next/navigation';

const mockedUsePathname = vi.mocked(usePathname);

describe('AppNavWrapper', () => {
  beforeEach(() => {
    mockedUsePathname.mockReturnValue('/dashboard');
  });

  it('renders AppNav for normal routes like /dashboard', () => {
    render(<AppNavWrapper />);
    // AppNav has Sign Out button; PublicNav has Get Started link
    expect(screen.getByText('Sign Out')).toBeInTheDocument();
  });

  it('returns null on the home page (/)', () => {
    mockedUsePathname.mockReturnValue('/');
    const { container } = render(<AppNavWrapper />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null for /portal routes', () => {
    mockedUsePathname.mockReturnValue('/portal/tickets');
    const { container } = render(<AppNavWrapper />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null for /sign-in routes', () => {
    mockedUsePathname.mockReturnValue('/sign-in');
    const { container } = render(<AppNavWrapper />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null for /sign-up routes', () => {
    mockedUsePathname.mockReturnValue('/sign-up');
    const { container } = render(<AppNavWrapper />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null for /chat/embed routes', () => {
    mockedUsePathname.mockReturnValue('/chat/embed');
    const { container } = render(<AppNavWrapper />);
    expect(container.innerHTML).toBe('');
  });

  it('renders PublicNav for /docs', () => {
    mockedUsePathname.mockReturnValue('/docs');
    render(<AppNavWrapper />);
    // PublicNav has "Get Started" and "Sign In" — no "Sign Out"
    expect(screen.getByText('Get Started')).toBeInTheDocument();
    expect(screen.getByText('Sign In')).toBeInTheDocument();
    expect(screen.queryByText('Sign Out')).not.toBeInTheDocument();
  });

  it('renders PublicNav for /docs sub-routes', () => {
    mockedUsePathname.mockReturnValue('/docs/api');
    render(<AppNavWrapper />);
    expect(screen.getByText('Get Started')).toBeInTheDocument();
    expect(screen.queryByText('Sign Out')).not.toBeInTheDocument();
  });

  it('renders AppNav for non-excluded routes like /analytics', () => {
    mockedUsePathname.mockReturnValue('/analytics');
    render(<AppNavWrapper />);
    expect(screen.getByText('Sign Out')).toBeInTheDocument();
  });
});
