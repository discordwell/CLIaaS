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
    expect(screen.getByText(/Replace your helpdesk UI with a CLI/)).toBeInTheDocument();
  });

  it('renders the Open Dashboard CTA link', () => {
    render(<Home />);
    const dashboardLink = screen.getByText('Open Dashboard');
    expect(dashboardLink.closest('a')).toHaveAttribute('href', '/dashboard');
  });

  it('renders the GitHub link with correct target', () => {
    render(<Home />);
    const githubLink = screen.getByText('GitHub');
    expect(githubLink.closest('a')).toHaveAttribute('href', 'https://github.com/discordwell/CLIaaS');
    expect(githubLink.closest('a')).toHaveAttribute('target', '_blank');
  });

  it('renders tier cards', () => {
    render(<Home />);
    expect(screen.getByText('BYOC (Free)')).toBeInTheDocument();
    expect(screen.getByText('Hosted (Paid)')).toBeInTheDocument();
    expect(screen.getByText('Hybrid')).toBeInTheDocument();
  });

  it('renders the workflow demo section', () => {
    render(<Home />);
    expect(screen.getByText('Workflow Demo')).toBeInTheDocument();
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
