// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import Home from '../page';
import NotFound from '../not-found';

describe('Home page', () => {
  it('renders without crashing', () => {
    const { container } = render(<Home />);
    expect(container.querySelector('main')).toBeInTheDocument();
  });

  it('renders the hero headline', () => {
    render(<Home />);
    expect(screen.getByText('AI lives in the command line.')).toBeInTheDocument();
    expect(screen.getByText('Now, so does your helpdesk.')).toBeInTheDocument();
  });

  it('renders the Get Started Free CTA link', () => {
    render(<Home />);
    const signupLinks = screen.getAllByText('Get Started Free');
    expect(signupLinks[0].closest('a')).toHaveAttribute('href', '/sign-up');
  });

  it('renders the Sign In link', () => {
    render(<Home />);
    const signinLink = screen.getAllByText('Sign In')[0];
    expect(signinLink.closest('a')).toHaveAttribute('href', '/sign-in');
  });

  it('renders pricing section with three tiers', () => {
    render(<Home />);
    expect(screen.getByText('BYOC')).toBeInTheDocument();
    expect(screen.getByText('Pro Hosted')).toBeInTheDocument();
    expect(screen.getByText('Enterprise')).toBeInTheDocument();
  });

  it('shows equinox promo', () => {
    render(<Home />);
    const matches = screen.getAllByText(/March Equinox/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the terminal demo section', () => {
    render(<Home />);
    expect(screen.getByText('cliaas')).toBeInTheDocument();
  });

  it('renders the MCP server section', () => {
    render(<Home />);
    expect(screen.getByText(/Your helpdesk is now an AI tool/)).toBeInTheDocument();
  });

  it('renders connector names', () => {
    render(<Home />);
    expect(screen.getByText('Zendesk')).toBeInTheDocument();
    expect(screen.getByText('Intercom')).toBeInTheDocument();
  });

  it('shows $79/mo for Pro Hosted', () => {
    render(<Home />);
    expect(screen.getByText('$79')).toBeInTheDocument();
  });
});

describe('NotFound page', () => {
  it('renders without crashing', () => {
    const { container } = render(<NotFound />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('displays 404 text', () => {
    render(<NotFound />);
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('displays "Route not found" message', () => {
    render(<NotFound />);
    expect(screen.getByText('Route not found')).toBeInTheDocument();
  });

  it('renders a return link to home', () => {
    render(<NotFound />);
    const returnLink = screen.getByText('Return to dashboard');
    expect(returnLink.closest('a')).toHaveAttribute('href', '/');
  });
});
