// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TicketActions from '../TicketActions';

describe('TicketActions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the Update Ticket section', () => {
    render(<TicketActions ticketId="t1" currentStatus="open" currentPriority="normal" />);
    expect(screen.getByText('Update Ticket')).toBeInTheDocument();
  });

  it('renders the Reply section', () => {
    render(<TicketActions ticketId="t1" currentStatus="open" currentPriority="normal" />);
    expect(screen.getByText('Reply')).toBeInTheDocument();
  });

  it('renders status select with current value', () => {
    render(<TicketActions ticketId="t1" currentStatus="pending" currentPriority="normal" />);
    const statusSelect = screen.getByDisplayValue('PENDING');
    expect(statusSelect).toBeInTheDocument();
  });

  it('renders priority select with current value', () => {
    render(<TicketActions ticketId="t1" currentStatus="open" currentPriority="high" />);
    const prioritySelect = screen.getByDisplayValue('HIGH');
    expect(prioritySelect).toBeInTheDocument();
  });

  it('disables Save Changes button when nothing has changed', () => {
    render(<TicketActions ticketId="t1" currentStatus="open" currentPriority="normal" />);
    const saveBtn = screen.getByText('Save Changes');
    expect(saveBtn).toBeDisabled();
  });

  it('enables Save Changes button when status changes', () => {
    render(<TicketActions ticketId="t1" currentStatus="open" currentPriority="normal" />);
    const statusSelect = screen.getByDisplayValue('OPEN');
    fireEvent.change(statusSelect, { target: { value: 'pending' } });
    const saveBtn = screen.getByText('Save Changes');
    expect(saveBtn).not.toBeDisabled();
  });

  it('renders the reply textarea with placeholder', () => {
    render(<TicketActions ticketId="t1" currentStatus="open" currentPriority="normal" />);
    expect(screen.getByPlaceholderText('Type your reply...')).toBeInTheDocument();
  });

  it('shows "Send Reply" button by default', () => {
    render(<TicketActions ticketId="t1" currentStatus="open" currentPriority="normal" />);
    expect(screen.getByText('Send Reply')).toBeInTheDocument();
  });

  it('changes button text to "Add Note" when internal note checkbox is checked', () => {
    render(<TicketActions ticketId="t1" currentStatus="open" currentPriority="normal" />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(screen.getByText('Add Note')).toBeInTheDocument();
  });

  it('disables reply button when textarea is empty', () => {
    render(<TicketActions ticketId="t1" currentStatus="open" currentPriority="normal" />);
    const replyBtn = screen.getByText('Send Reply');
    expect(replyBtn).toBeDisabled();
  });

  it('enables reply button when textarea has content', () => {
    render(<TicketActions ticketId="t1" currentStatus="open" currentPriority="normal" />);
    const textarea = screen.getByPlaceholderText('Type your reply...');
    fireEvent.change(textarea, { target: { value: 'Hello there' } });
    const replyBtn = screen.getByText('Send Reply');
    expect(replyBtn).not.toBeDisabled();
  });

  it('sends reply and shows success message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as Response);

    render(<TicketActions ticketId="t1" currentStatus="open" currentPriority="normal" />);
    const textarea = screen.getByPlaceholderText('Type your reply...');
    fireEvent.change(textarea, { target: { value: 'Test reply' } });
    fireEvent.click(screen.getByText('Send Reply'));

    await waitFor(() => {
      expect(screen.getByText('Reply sent')).toBeInTheDocument();
    });
  });

  it('calls PATCH endpoint and shows success when saving changes', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as Response);

    render(<TicketActions ticketId="t1" currentStatus="open" currentPriority="normal" />);
    const statusSelect = screen.getByDisplayValue('OPEN');
    fireEvent.change(statusSelect, { target: { value: 'solved' } });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(screen.getByText('Updated')).toBeInTheDocument();
    });
  });
});
