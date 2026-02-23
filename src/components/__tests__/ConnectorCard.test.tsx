// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConnectorCard from '../ConnectorCard';
import type { ConnectorMeta } from '@/lib/connector-service';

function makeConnector(overrides: Partial<ConnectorMeta> = {}): ConnectorMeta {
  return {
    id: 'zendesk' as ConnectorMeta['id'],
    name: 'Zendesk',
    envVars: {
      ZENDESK_SUBDOMAIN: 'test',
      ZENDESK_EMAIL: 'a@b.com',
      ZENDESK_API_TOKEN: 'tok123',
    },
    configured: true,
    hasExport: true,
    exportDir: '/tmp/exports/zendesk',
    ticketCount: 26,
    messageCount: 42,
    customerCount: 10,
    kbArticleCount: 5,
    lastExport: '2026-01-15T10:30:00Z',
    ...overrides,
  };
}

describe('ConnectorCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the connector name', () => {
    render(<ConnectorCard connector={makeConnector()} />);
    expect(screen.getByText('Zendesk')).toBeInTheDocument();
  });

  it('shows "configured" badge when configured', () => {
    render(<ConnectorCard connector={makeConnector({ configured: true })} />);
    expect(screen.getByText('configured')).toBeInTheDocument();
  });

  it('shows "missing credentials" badge when not configured', () => {
    render(<ConnectorCard connector={makeConnector({ configured: false })} />);
    expect(screen.getByText('missing credentials')).toBeInTheDocument();
  });

  it('renders environment variable names', () => {
    render(<ConnectorCard connector={makeConnector()} />);
    expect(screen.getByText('ZENDESK_SUBDOMAIN')).toBeInTheDocument();
    expect(screen.getByText('ZENDESK_EMAIL')).toBeInTheDocument();
    expect(screen.getByText('ZENDESK_API_TOKEN')).toBeInTheDocument();
  });

  it('displays export stats when hasExport is true', () => {
    render(<ConnectorCard connector={makeConnector()} />);
    expect(screen.getByText('26')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('hides export stats when hasExport is false', () => {
    render(<ConnectorCard connector={makeConnector({ hasExport: false })} />);
    expect(screen.queryByText('Last Export')).not.toBeInTheDocument();
  });

  it('shows action buttons when all env vars are set', () => {
    render(<ConnectorCard connector={makeConnector()} />);
    expect(screen.getByText('Verify Connection')).toBeInTheDocument();
    expect(screen.getByText('Pull Data')).toBeInTheDocument();
  });

  it('hides action buttons when env vars are missing', () => {
    const connector = makeConnector({
      envVars: {
        ZENDESK_SUBDOMAIN: 'test',
        ZENDESK_EMAIL: undefined,
        ZENDESK_API_TOKEN: undefined,
      },
    });
    render(<ConnectorCard connector={connector} />);
    expect(screen.queryByText('Verify Connection')).not.toBeInTheDocument();
    expect(screen.queryByText('Pull Data')).not.toBeInTheDocument();
  });

  it('calls verify endpoint and displays success message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ userName: 'Admin', agentCount: 3, ticketCount: 26 }),
    } as Response);

    render(<ConnectorCard connector={makeConnector()} />);
    fireEvent.click(screen.getByText('Verify Connection'));

    await waitFor(() => {
      expect(screen.getByText(/Admin/)).toBeInTheDocument();
    });
  });

  it('displays error message when verify fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Invalid credentials' }),
    } as Response);

    render(<ConnectorCard connector={makeConnector()} />);
    fireEvent.click(screen.getByText('Verify Connection'));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });
});
