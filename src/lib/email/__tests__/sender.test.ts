import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock calls are hoisted, so we can't reference variables defined with const/let.
// Use vi.hoisted() to define the mock function that will be available during hoisting.
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({
    success: true,
    messageId: 'test-msg-1',
    provider: 'console',
  }),
}));

vi.mock('../provider', () => ({
  getProvider: vi.fn().mockReturnValue({
    name: 'console',
    send: mockSend,
  }),
}));

vi.mock('../../queue/dispatch', () => ({
  enqueueEmailSend: vi.fn().mockResolvedValue(false),
}));

import { sendEmail, sendTicketReply, sendNotification } from '../sender';
import { enqueueEmailSend } from '../../queue/dispatch';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: queue not available, so inline send
  vi.mocked(enqueueEmailSend).mockResolvedValue(false);
  mockSend.mockResolvedValue({
    success: true,
    messageId: 'test-msg-1',
    provider: 'console',
  });
});

// ---------------------------------------------------------------------------
// sendEmail
// ---------------------------------------------------------------------------

describe('sendEmail', () => {
  it('tries to enqueue before sending inline', async () => {
    await sendEmail({ to: 'a@b.com', subject: 'Hi' });
    expect(enqueueEmailSend).toHaveBeenCalledOnce();
  });

  it('skips queue when _skipQueue is true', async () => {
    await sendEmail({ to: 'a@b.com', subject: 'Hi' }, true);
    expect(enqueueEmailSend).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('returns queued result when queue accepts the job', async () => {
    vi.mocked(enqueueEmailSend).mockResolvedValue(true);
    const result = await sendEmail({ to: 'a@b.com', subject: 'Hi' });
    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^queued-/);
    // Provider should NOT be called since the job was enqueued
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends inline when queue is unavailable', async () => {
    const result = await sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body' });
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('test-msg-1');
    expect(mockSend).toHaveBeenCalledOnce();

    const msg = mockSend.mock.calls[0][0];
    expect(msg.to).toBe('a@b.com');
    expect(msg.subject).toBe('Hi');
    expect(msg.text).toBe('Body');
  });

  it('maps inReplyTo and references to headers', async () => {
    await sendEmail({
      to: 'a@b.com',
      subject: 'Re: Test',
      inReplyTo: '<orig@mail.com>',
      references: '<thread@mail.com>',
    }, true);

    const msg = mockSend.mock.calls[0][0];
    expect(msg.headers?.['In-Reply-To']).toBe('<orig@mail.com>');
    expect(msg.headers?.['References']).toBe('<thread@mail.com>');
  });

  it('does not include headers object when no threading headers', async () => {
    await sendEmail({ to: 'a@b.com', subject: 'Plain' }, true);
    const msg = mockSend.mock.calls[0][0];
    expect(msg.headers).toBeUndefined();
  });

  it('returns error on provider failure', async () => {
    mockSend.mockResolvedValue({
      success: false,
      error: 'Provider down',
      provider: 'resend',
    });

    const result = await sendEmail({ to: 'a@b.com', subject: 'Fail' }, true);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Provider down');
  });
});

// ---------------------------------------------------------------------------
// sendTicketReply
// ---------------------------------------------------------------------------

describe('sendTicketReply', () => {
  it('sends a reply with threading headers', async () => {
    const result = await sendTicketReply({
      ticketId: 'tk-42',
      customerEmail: 'customer@test.com',
      subject: 'Help me',
      body: 'We fixed it.',
    });

    expect(result.success).toBe(true);
    expect(mockSend).toHaveBeenCalledOnce();

    const msg = mockSend.mock.calls[0][0];
    expect(msg.to).toBe('customer@test.com');
    expect(msg.subject).toBe('Re: Help me');
    expect(msg.headers?.['In-Reply-To']).toContain('ticket-tk-42@');
    expect(msg.headers?.['References']).toContain('ticket-tk-42@');
  });

  it('preserves Re: prefix when already present', async () => {
    await sendTicketReply({
      ticketId: 'tk-1',
      customerEmail: 'c@t.com',
      subject: 'Re: Already there',
      body: 'Ok',
    });

    const msg = mockSend.mock.calls[0][0];
    expect(msg.subject).toBe('Re: Already there');
  });

  it('includes agent name in from when provided', async () => {
    await sendTicketReply({
      ticketId: 'tk-1',
      customerEmail: 'c@t.com',
      subject: 'Test',
      body: 'Ok',
      agentName: 'Alice',
    });

    const msg = mockSend.mock.calls[0][0];
    expect(msg.from).toContain('Alice via CLIaaS');
  });
});

// ---------------------------------------------------------------------------
// sendNotification
// ---------------------------------------------------------------------------

describe('sendNotification', () => {
  it('sends an escalation notification', async () => {
    await sendNotification({
      to: 'admin@test.com',
      template: 'escalation',
      data: { subject: 'Urgent bug', ticketId: 'tk-99' },
    });

    const msg = mockSend.mock.calls[0][0];
    expect(msg.to).toBe('admin@test.com');
    expect(msg.subject).toContain('Ticket escalated');
    expect(msg.subject).toContain('Urgent bug');
  });

  it('sends an SLA breach notification', async () => {
    await sendNotification({
      to: 'admin@test.com',
      template: 'sla_breach',
      data: { subject: 'Slow response' },
    });

    const msg = mockSend.mock.calls[0][0];
    expect(msg.subject).toContain('SLA breach');
  });

  it('falls back to generic subject for unknown template', async () => {
    await sendNotification({
      to: 'admin@test.com',
      template: 'custom_thing',
      data: {},
    });

    const msg = mockSend.mock.calls[0][0];
    expect(msg.subject).toBe('[CLIaaS] Notification');
  });
});
