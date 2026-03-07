/**
 * @vitest-environment jsdom
 *
 * Tests for the SSO and SCIM admin pages and the settings layout.
 * Validates component rendering, form behaviour, and API integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

/* ------------------------------------------------------------------ */
/*  Mock next/link (App Router)                                        */
/* ------------------------------------------------------------------ */

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...props }, children),
}));

/* ------------------------------------------------------------------ */
/*  Mock fetch globally                                                */
/* ------------------------------------------------------------------ */

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as Response);
}

/* ------------------------------------------------------------------ */
/*  Settings layout                                                    */
/* ------------------------------------------------------------------ */

describe('Settings Layout', () => {
  it('renders nav with SSO and SCIM links', async () => {
    const { default: SettingsLayout } = await import(
      '@/app/dashboard/settings/layout'
    );
    // Layout is a server component exporting metadata + a default function.
    // We render its JSX output synchronously.
    const { container } = render(
      React.createElement(SettingsLayout, {
        children: React.createElement('div', { 'data-testid': 'child' }, 'CHILD'),
      }),
    );

    // Should have links to SSO and SCIM
    const links = container.querySelectorAll('a');
    const hrefs = Array.from(links).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/dashboard/settings/sso');
    expect(hrefs).toContain('/dashboard/settings/scim');
    expect(hrefs).toContain('/dashboard');

    // Children are rendered
    expect(screen.getByTestId('child')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  SSO Admin Page                                                     */
/* ------------------------------------------------------------------ */

describe('SSO Admin Page', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const mockProviders = [
    {
      id: 'sso-1',
      name: 'Okta Prod',
      protocol: 'saml',
      enabled: true,
      domainHint: 'acme.com',
      entityId: 'https://okta.example.com',
      ssoUrl: 'https://okta.example.com/sso',
      certificate: 'MIID1234567890ab...',
      signedAssertions: true,
      defaultRole: 'agent',
      jitEnabled: true,
      forceAuthn: false,
      createdAt: '2026-01-15T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    },
    {
      id: 'sso-2',
      name: 'Google OIDC',
      protocol: 'oidc',
      enabled: false,
      domainHint: 'corp.com',
      clientId: 'goog-client-id',
      clientSecret: '••••••••',
      issuer: 'https://accounts.google.com',
      createdAt: '2026-02-20T00:00:00.000Z',
      updatedAt: '2026-02-20T00:00:00.000Z',
    },
  ];

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/auth/sso/providers') && !url.includes('/sso-')) {
        return jsonResponse({ providers: mockProviders });
      }
      // Default for creates/updates/deletes
      return jsonResponse({ ok: true });
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('renders header and "Add Provider" button', async () => {
    const { default: SSOPage } = await import(
      '@/app/dashboard/settings/sso/page'
    );

    await act(async () => {
      render(React.createElement(SSOPage));
    });

    expect(screen.getByText('Single Sign-On')).toBeTruthy();
    expect(screen.getByText('Add Provider')).toBeTruthy();
  });

  it('displays provider cards with badges', async () => {
    const { default: SSOPage } = await import(
      '@/app/dashboard/settings/sso/page'
    );

    await act(async () => {
      render(React.createElement(SSOPage));
    });

    await waitFor(() => {
      expect(screen.getByText('Okta Prod')).toBeTruthy();
      expect(screen.getByText('Google OIDC')).toBeTruthy();
    });

    // Protocol badges
    expect(screen.getByText('saml')).toBeTruthy();
    expect(screen.getByText('oidc')).toBeTruthy();

    // Status badges
    expect(screen.getByText('Enabled')).toBeTruthy();
    expect(screen.getByText('Disabled')).toBeTruthy();

    // Domain hints
    expect(screen.getByText('acme.com')).toBeTruthy();
    expect(screen.getByText('corp.com')).toBeTruthy();
  });

  it('opens inline form when clicking a provider card', async () => {
    const { default: SSOPage } = await import(
      '@/app/dashboard/settings/sso/page'
    );

    await act(async () => {
      render(React.createElement(SSOPage));
    });

    await waitFor(() => {
      expect(screen.getByText('Okta Prod')).toBeTruthy();
    });

    // Click the provider card to expand
    await act(async () => {
      fireEvent.click(screen.getByText('Okta Prod'));
    });

    // Should show SAML-specific fields (Update button, test button)
    expect(screen.getByText('Update Provider')).toBeTruthy();
    expect(screen.getByText('Test Connection')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('opens add form when clicking "Add Provider"', async () => {
    const { default: SSOPage } = await import(
      '@/app/dashboard/settings/sso/page'
    );

    await act(async () => {
      render(React.createElement(SSOPage));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Add Provider'));
    });

    expect(screen.getByText('New Provider')).toBeTruthy();
    expect(screen.getByText('Create Provider')).toBeTruthy();
  });

  it('shows protocol tabs that switch between SAML and OIDC fields', async () => {
    const { default: SSOPage } = await import(
      '@/app/dashboard/settings/sso/page'
    );

    await act(async () => {
      render(React.createElement(SSOPage));
    });

    // Open add form
    await act(async () => {
      fireEvent.click(screen.getByText('Add Provider'));
    });

    // Default is SAML - should see Entity ID label
    expect(screen.getByText('Entity ID')).toBeTruthy();
    expect(screen.getByText('SSO URL')).toBeTruthy();

    // Switch to OIDC tab
    const oidcTab = screen.getAllByText('oidc').find(
      (el) => el.tagName === 'BUTTON',
    );
    expect(oidcTab).toBeTruthy();

    await act(async () => {
      fireEvent.click(oidcTab!);
    });

    // Should now see OIDC fields
    expect(screen.getByText('Client ID')).toBeTruthy();
    expect(screen.getByText('Issuer URL')).toBeTruthy();
  });

  it('shows delete confirmation when delete button is clicked', async () => {
    const { default: SSOPage } = await import(
      '@/app/dashboard/settings/sso/page'
    );

    await act(async () => {
      render(React.createElement(SSOPage));
    });

    await waitFor(() => {
      expect(screen.getByText('Okta Prod')).toBeTruthy();
    });

    // Open edit for first provider
    await act(async () => {
      fireEvent.click(screen.getByText('Okta Prod'));
    });

    // Click Delete
    await act(async () => {
      fireEvent.click(screen.getByText('Delete'));
    });

    // Should show confirmation
    expect(screen.getByText('Confirm delete?')).toBeTruthy();
    expect(screen.getByText('Yes, Delete')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
  });

  it('calls POST on save for new provider', async () => {
    const { default: SSOPage } = await import(
      '@/app/dashboard/settings/sso/page'
    );

    await act(async () => {
      render(React.createElement(SSOPage));
    });

    // Open add form
    await act(async () => {
      fireEvent.click(screen.getByText('Add Provider'));
    });

    // Fill in name
    const nameInput = screen.getByPlaceholderText('e.g. Okta Production');
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'Test SAML' } });
    });

    // Click Create
    await act(async () => {
      fireEvent.click(screen.getByText('Create Provider'));
    });

    // Verify POST was called
    const postCalls = fetchSpy.mock.calls.filter(([url, opts]) => {
      const u = typeof url === 'string' ? url : (url as Request).url;
      return u.includes('/api/auth/sso/providers') && (opts as RequestInit)?.method === 'POST';
    });
    expect(postCalls.length).toBe(1);
  });

  it('shows test result after clicking Test Connection', async () => {
    const { default: SSOPage } = await import(
      '@/app/dashboard/settings/sso/page'
    );

    await act(async () => {
      render(React.createElement(SSOPage));
    });

    // Open add form
    await act(async () => {
      fireEvent.click(screen.getByText('Add Provider'));
    });

    // Click Test Connection (should fail validation for missing fields)
    await act(async () => {
      fireEvent.click(screen.getByText('Test Connection'));
    });

    await waitFor(() => {
      expect(screen.getByText('FAIL')).toBeTruthy();
    });
  });
});

/* ------------------------------------------------------------------ */
/*  SCIM Admin Page                                                    */
/* ------------------------------------------------------------------ */

describe('SCIM Admin Page', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const mockUsers = [
    {
      id: 'usr-1',
      userName: 'alice@acme.com',
      name: { formatted: 'Alice Smith' },
      emails: [{ value: 'alice@acme.com', type: 'work', primary: true }],
      active: true,
      meta: {
        resourceType: 'User',
        created: '2026-01-10T00:00:00.000Z',
        lastModified: '2026-02-15T00:00:00.000Z',
      },
    },
  ];

  const mockGroups = [
    {
      id: 'grp-1',
      displayName: 'Engineering',
      members: [
        { value: 'usr-1', display: 'Alice Smith' },
        { value: 'usr-2', display: 'Bob Jones' },
      ],
      meta: {
        resourceType: 'Group',
        created: '2026-01-10T00:00:00.000Z',
        lastModified: '2026-02-15T00:00:00.000Z',
      },
    },
  ];

  const mockAudit = [
    {
      id: 'aud-1',
      workspaceId: 'default',
      action: 'user.created',
      entityType: 'user',
      entityId: 'usr-1',
      actorId: 'scim-client',
      changes: { name: 'Alice Smith' },
      timestamp: '2026-01-10T00:00:00.000Z',
    },
    {
      id: 'aud-2',
      workspaceId: 'default',
      action: 'group.updated',
      entityType: 'group',
      entityId: 'grp-1',
      timestamp: '2026-02-01T00:00:00.000Z',
    },
  ];

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/settings/scim-token')) {
        return jsonResponse({ token: 'test-scim-token-xyz' });
      }
      if (url.includes('/api/scim/v2/Users')) {
        return jsonResponse({ Resources: mockUsers, totalResults: 1 });
      }
      if (url.includes('/api/scim/v2/Groups')) {
        return jsonResponse({ Resources: mockGroups, totalResults: 1 });
      }
      if (url.includes('/api/scim/audit')) {
        return jsonResponse({ entries: mockAudit });
      }
      return jsonResponse({});
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('renders header with "Configured" status badge', async () => {
    const { default: SCIMPage } = await import(
      '@/app/dashboard/settings/scim/page'
    );

    await act(async () => {
      render(React.createElement(SCIMPage));
    });

    expect(screen.getByText('SCIM Provisioning')).toBeTruthy();
    expect(screen.getByText('Configured')).toBeTruthy();
  });

  it('shows endpoint info panel with base URL and masked token', async () => {
    const { default: SCIMPage } = await import(
      '@/app/dashboard/settings/scim/page'
    );

    await act(async () => {
      render(React.createElement(SCIMPage));
    });

    // Base URL label
    expect(screen.getByText('Base URL')).toBeTruthy();
    expect(screen.getByText('Bearer Token')).toBeTruthy();

    // Copy button should exist
    expect(screen.getByText('Copy')).toBeTruthy();
  });

  it('displays provisioned users table', async () => {
    const { default: SCIMPage } = await import(
      '@/app/dashboard/settings/scim/page'
    );

    await act(async () => {
      render(React.createElement(SCIMPage));
    });

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeTruthy();
    });

    // User email
    expect(screen.getByText('alice@acme.com')).toBeTruthy();
    // Active badge
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('displays provisioned groups table', async () => {
    const { default: SCIMPage } = await import(
      '@/app/dashboard/settings/scim/page'
    );

    await act(async () => {
      render(React.createElement(SCIMPage));
    });

    await waitFor(() => {
      expect(screen.getByText('Engineering')).toBeTruthy();
    });

    // Member count badge — use getAllByText since "2" may appear in the audit log count too
    const twos = screen.getAllByText('2');
    const memberBadge = twos.find((el) =>
      el.className.includes('bg-zinc-50'),
    );
    expect(memberBadge).toBeTruthy();
  });

  it('displays audit log with action badges', async () => {
    const { default: SCIMPage } = await import(
      '@/app/dashboard/settings/scim/page'
    );

    await act(async () => {
      render(React.createElement(SCIMPage));
    });

    await waitFor(() => {
      expect(screen.getByText('user.created')).toBeTruthy();
    });

    expect(screen.getByText('group.updated')).toBeTruthy();
  });

  it('shows "Not Configured" when no token is returned from API', async () => {
    fetchSpy.mockRestore();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/settings/scim-token')) {
        return jsonResponse({ token: null });
      }
      if (url.includes('/api/scim/v2/Users')) {
        return jsonResponse({ Resources: [], totalResults: 0 });
      }
      if (url.includes('/api/scim/v2/Groups')) {
        return jsonResponse({ Resources: [], totalResults: 0 });
      }
      if (url.includes('/api/scim/audit')) {
        return jsonResponse({ entries: [] });
      }
      return jsonResponse({});
    });

    vi.resetModules();

    const { default: SCIMPage } = await import(
      '@/app/dashboard/settings/scim/page'
    );

    await act(async () => {
      render(React.createElement(SCIMPage));
    });

    expect(screen.getByText('Not Configured')).toBeTruthy();
  });

  it('fetches token from server-side API and uses it for SCIM calls', async () => {
    const { default: SCIMPage } = await import(
      '@/app/dashboard/settings/scim/page'
    );

    await act(async () => {
      render(React.createElement(SCIMPage));
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });

    // Should have fetched the token from /api/settings/scim-token
    const tokenCalls = fetchSpy.mock.calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      return url.includes('/api/settings/scim-token');
    });
    expect(tokenCalls.length).toBeGreaterThan(0);

    // After token is loaded, SCIM calls should have the Authorization header
    await waitFor(() => {
      const callsWithAuth = fetchSpy.mock.calls.filter(([, opts]) => {
        const headers = (opts as RequestInit)?.headers;
        if (headers && typeof headers === 'object' && 'Authorization' in headers) {
          return (headers as Record<string, string>).Authorization.includes('Bearer');
        }
        return false;
      });
      expect(callsWithAuth.length).toBeGreaterThan(0);
    });
  });
});
