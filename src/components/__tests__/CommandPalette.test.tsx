// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

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

import CommandPalette from '../CommandPalette';

describe('CommandPalette', () => {
  beforeEach(() => {
    mockPush.mockClear();
    try { localStorage.removeItem('cliaas-cmd-recents'); } catch { /* jsdom */ }
  });

  it('does not render when closed', () => {
    const { container } = render(<CommandPalette />);
    expect(container.innerHTML).toBe('');
  });

  it('opens on Cmd+K', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument();
  });

  it('opens on Ctrl+K', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument();
  });

  it('opens on custom event', () => {
    render(<CommandPalette />);
    act(() => { window.dispatchEvent(new Event('open-command-palette')); });
    expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByPlaceholderText('Type a command or search...'), { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Type a command or search...')).not.toBeInTheDocument();
  });

  it('shows all groups when open with no query', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByText('Core')).toBeInTheDocument();
    expect(screen.getByText('Automate')).toBeInTheDocument();
    expect(screen.getByText('Engage')).toBeInTheDocument();
    expect(screen.getByText('Insights')).toBeInTheDocument();
    expect(screen.getByText('Configure')).toBeInTheDocument();
  });

  it('filters results on search', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = screen.getByPlaceholderText('Type a command or search...');
    fireEvent.change(input, { target: { value: 'campai' } });
    // Description text isn't split by highlight spans
    expect(screen.getByText('Outbound messaging campaigns')).toBeInTheDocument();
    // Should not show unrelated items
    expect(screen.queryByText('SSO, SCIM & access controls')).not.toBeInTheDocument();
  });

  it('shows no results message for unmatched query', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = screen.getByPlaceholderText('Type a command or search...');
    fireEvent.change(input, { target: { value: 'xyznothing' } });
    expect(screen.getByText(/No results for/)).toBeInTheDocument();
  });

  it('navigates on Enter', async () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = screen.getByPlaceholderText('Type a command or search...');
    // First item is Dashboard (current route group: Core)
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows HERE badge for current route', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByText('HERE')).toBeInTheDocument();
  });

  it('shows keyboard hints in footer', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByText('navigate')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText('close')).toBeInTheDocument();
  });
});
