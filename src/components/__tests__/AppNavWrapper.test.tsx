// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/dashboard'),
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
    expect(screen.getByText('CLIaaS')).toBeInTheDocument();
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

  it('renders AppNav for non-excluded routes like /analytics', () => {
    mockedUsePathname.mockReturnValue('/analytics');
    render(<AppNavWrapper />);
    expect(screen.getByText('CLIaaS')).toBeInTheDocument();
  });
});
