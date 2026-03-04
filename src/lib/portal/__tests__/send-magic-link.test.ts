import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../email/sender', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-1' }),
}));

import { sendMagicLink } from '../send-magic-link';
import { sendEmail } from '../../email/sender';

const savedAppName = process.env.NEXT_PUBLIC_APP_NAME;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_APP_NAME;
});

afterEach(() => {
  if (savedAppName !== undefined) {
    process.env.NEXT_PUBLIC_APP_NAME = savedAppName;
  } else {
    delete process.env.NEXT_PUBLIC_APP_NAME;
  }
});

describe('sendMagicLink', () => {
  it('sends an email with the verify URL', async () => {
    await sendMagicLink('user@test.com', 'https://example.com/verify?token=abc');

    expect(sendEmail).toHaveBeenCalledOnce();
    const opts = vi.mocked(sendEmail).mock.calls[0][0];
    expect(opts.to).toBe('user@test.com');
    expect(opts.subject).toContain('sign-in link');
    expect(opts.text).toContain('https://example.com/verify?token=abc');
    expect(opts.html).toContain('https://example.com/verify?token=abc');
  });

  it('includes the app name from env', async () => {
    process.env.NEXT_PUBLIC_APP_NAME = 'MyDesk';
    await sendMagicLink('user@test.com', 'https://example.com/verify?token=abc');

    const opts = vi.mocked(sendEmail).mock.calls[0][0];
    expect(opts.subject).toContain('MyDesk');
    expect(opts.text).toContain('MyDesk');
    expect(opts.html).toContain('MyDesk');
  });

  it('defaults app name to CLIaaS', async () => {
    await sendMagicLink('user@test.com', 'https://example.com/verify');

    const opts = vi.mocked(sendEmail).mock.calls[0][0];
    expect(opts.subject).toContain('CLIaaS');
  });

  it('does not throw on send failure', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Provider down' });

    // Should not throw
    await expect(sendMagicLink('user@test.com', 'https://example.com/verify')).resolves.toBeUndefined();
  });
});
