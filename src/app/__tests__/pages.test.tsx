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
    expect(screen.getByText(/AI lives in the command line/)).toBeInTheDocument();
  });

  it('renders the Open Dashboard CTA link', () => {
    render(<Home />);
    const dashboardLink = screen.getByText('Open Dashboard');
    expect(dashboardLink.closest('a')).toHaveAttribute('href', '/dashboard');
  });

  it('renders the Read Docs CTA link', () => {
    render(<Home />);
    const docsLink = screen.getByText('Read Docs');
    expect(docsLink.closest('a')).toHaveAttribute('href', '/docs');
  });

  it('renders the GitHub link with correct target', () => {
    render(<Home />);
    const githubLink = screen.getByText('GitHub');
    expect(githubLink.closest('a')).toHaveAttribute('href', 'https://github.com/discordwell/CLIaaS');
    expect(githubLink.closest('a')).toHaveAttribute('target', '_blank');
  });

  it('renders connector names', () => {
    render(<Home />);
    expect(screen.getByText('Zendesk')).toBeInTheDocument();
    expect(screen.getByText('Freshdesk')).toBeInTheDocument();
    expect(screen.getByText('Groove')).toBeInTheDocument();
  });

  it('renders capability sections', () => {
    render(<Home />);
    expect(screen.getByText('Ticket Management')).toBeInTheDocument();
    expect(screen.getByText('AI Intelligence')).toBeInTheDocument();
    expect(screen.getByText('Automation Engine')).toBeInTheDocument();
  });

  it('renders the stats bar', () => {
    render(<Home />);
    expect(screen.getByText('Phases Shipped')).toBeInTheDocument();
    expect(screen.getByText('Features Built')).toBeInTheDocument();
    expect(screen.getByText('Connectors Live')).toBeInTheDocument();
    expect(screen.getByText('LLM Providers')).toBeInTheDocument();
  });

  it('renders the footer', () => {
    render(<Home />);
    expect(screen.getByText('Zachathon 2026')).toBeInTheDocument();
  });

  it('renders route links', () => {
    render(<Home />);
    const ticketsLink = screen.getByText('/tickets');
    expect(ticketsLink.closest('a')).toHaveAttribute('href', '/tickets');
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
