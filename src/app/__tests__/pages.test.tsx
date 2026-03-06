// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Provide jsdom stubs for browser APIs used by page components
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// IntersectionObserver stub (HeroDemo video autoplay)
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor() {}
}
globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

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
    expect(screen.getByText('AI lives in the command line')).toBeInTheDocument();
    expect(screen.getByText('Now, so does your helpdesk')).toBeInTheDocument();
  });

  it('renders the Start Pro Hosted CTA link', () => {
    render(<Home />);
    const signupLinks = screen.getAllByText('Start Pro Hosted');
    expect(signupLinks[0].closest('a')).toHaveAttribute('href', '/sign-up');
  });

  it('renders the Sign In link', () => {
    render(<Home />);
    const signinLink = screen.getAllByText('Sign In')[0];
    expect(signinLink.closest('a')).toHaveAttribute('href', '/sign-in');
  });

  it('renders pricing section with three tiers', () => {
    render(<Home />);
    expect(screen.getAllByText('BYOC').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Pro Hosted')).toBeInTheDocument();
    expect(screen.getByText('Enterprise')).toBeInTheDocument();
  });

  it('shows Ides of March promo', () => {
    render(<Home />);
    const matches = screen.getAllByText(/Ides of March/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the terminal demo section', () => {
    render(<Home />);
    expect(screen.getByText('CLI')).toBeInTheDocument();
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

  it('shows $59/mo for Pro Hosted with $79 strikethrough', () => {
    render(<Home />);
    expect(screen.getByText('$79')).toBeInTheDocument();
    expect(screen.getByText('$59')).toBeInTheDocument();
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
