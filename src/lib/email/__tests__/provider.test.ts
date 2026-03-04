import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createProvider,
  resolveProviderName,
  resetProvider,
  getProvider,
} from '../provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const savedEnv: Record<string, string | undefined> = {};
const envKeys = [
  'EMAIL_PROVIDER',
  'RESEND_API_KEY',
  'SENDGRID_API_KEY',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_PORT',
  'SMTP_FROM',
  'EMAIL_FROM',
  'NEXT_PUBLIC_BASE_URL',
  'NEXT_PUBLIC_APP_NAME',
];

beforeEach(() => {
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetProvider();
});

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
  resetProvider();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// resolveProviderName
// ---------------------------------------------------------------------------

describe('resolveProviderName', () => {
  it('returns "console" when no env vars set', () => {
    expect(resolveProviderName()).toBe('console');
  });

  it('respects explicit EMAIL_PROVIDER=resend', () => {
    setEnv({ EMAIL_PROVIDER: 'resend' });
    expect(resolveProviderName()).toBe('resend');
  });

  it('respects explicit EMAIL_PROVIDER=sendgrid', () => {
    setEnv({ EMAIL_PROVIDER: 'sendgrid' });
    expect(resolveProviderName()).toBe('sendgrid');
  });

  it('respects explicit EMAIL_PROVIDER=smtp', () => {
    setEnv({ EMAIL_PROVIDER: 'smtp' });
    expect(resolveProviderName()).toBe('smtp');
  });

  it('respects explicit EMAIL_PROVIDER=console', () => {
    setEnv({ EMAIL_PROVIDER: 'console' });
    expect(resolveProviderName()).toBe('console');
  });

  it('is case-insensitive for explicit provider', () => {
    setEnv({ EMAIL_PROVIDER: 'RESEND' });
    expect(resolveProviderName()).toBe('resend');
  });

  it('auto-detects resend from RESEND_API_KEY', () => {
    setEnv({ RESEND_API_KEY: 're_test_key' });
    expect(resolveProviderName()).toBe('resend');
  });

  it('auto-detects sendgrid from SENDGRID_API_KEY', () => {
    setEnv({ SENDGRID_API_KEY: 'SG.test_key' });
    expect(resolveProviderName()).toBe('sendgrid');
  });

  it('auto-detects smtp from SMTP_HOST + SMTP_USER', () => {
    setEnv({ SMTP_HOST: 'mail.example.com', SMTP_USER: 'user' });
    expect(resolveProviderName()).toBe('smtp');
  });

  it('prefers resend over sendgrid in auto-detect', () => {
    setEnv({ RESEND_API_KEY: 're_key', SENDGRID_API_KEY: 'SG.key' });
    expect(resolveProviderName()).toBe('resend');
  });

  it('falls back to console for unknown EMAIL_PROVIDER value', () => {
    setEnv({ EMAIL_PROVIDER: 'mailchimp' });
    expect(resolveProviderName()).toBe('console');
  });
});

// ---------------------------------------------------------------------------
// createProvider — console
// ---------------------------------------------------------------------------

describe('console provider', () => {
  it('has name "console"', () => {
    const p = createProvider('console');
    expect(p.name).toBe('console');
  });

  it('returns success with console- prefixed messageId', async () => {
    const p = createProvider('console');
    const result = await p.send({
      to: 'user@example.com',
      subject: 'Test',
      text: 'Hello',
    });
    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^console-/);
    expect(result.provider).toBe('console');
  });
});

// ---------------------------------------------------------------------------
// createProvider — resend
// ---------------------------------------------------------------------------

describe('resend provider', () => {
  it('falls back to console when RESEND_API_KEY is missing', () => {
    const p = createProvider('resend');
    expect(p.name).toBe('console');
  });

  it('creates resend provider when key is present', () => {
    setEnv({ RESEND_API_KEY: 're_test_abc' });
    const p = createProvider('resend');
    expect(p.name).toBe('resend');
  });

  it('sends email via Resend API', async () => {
    setEnv({ RESEND_API_KEY: 're_test_abc' });
    const p = createProvider('resend');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'msg_resend_123' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await p.send({
      to: 'user@test.com',
      subject: 'Hello',
      text: 'World',
      html: '<p>World</p>',
      replyTo: 'support@test.com',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg_resend_123');
    expect(result.provider).toBe('resend');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer re_test_abc');

    const body = JSON.parse(opts.body);
    expect(body.to).toEqual(['user@test.com']);
    expect(body.subject).toBe('Hello');
    expect(body.text).toBe('World');
    expect(body.html).toBe('<p>World</p>');
    expect(body.reply_to).toBe('support@test.com');
  });

  it('handles Resend API errors', async () => {
    setEnv({ RESEND_API_KEY: 're_test_abc' });
    const p = createProvider('resend');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve('{"message":"Invalid email"}'),
    }));

    const result = await p.send({ to: 'bad', subject: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Resend 422');
    expect(result.provider).toBe('resend');
  });

  it('handles network failures', async () => {
    setEnv({ RESEND_API_KEY: 're_test_abc' });
    const p = createProvider('resend');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await p.send({ to: 'user@test.com', subject: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
    expect(result.provider).toBe('resend');
  });
});

// ---------------------------------------------------------------------------
// createProvider — sendgrid
// ---------------------------------------------------------------------------

describe('sendgrid provider', () => {
  it('falls back to console when SENDGRID_API_KEY is missing', () => {
    const p = createProvider('sendgrid');
    expect(p.name).toBe('console');
  });

  it('creates sendgrid provider when key is present', () => {
    setEnv({ SENDGRID_API_KEY: 'SG.test_abc' });
    const p = createProvider('sendgrid');
    expect(p.name).toBe('sendgrid');
  });

  it('sends email via SendGrid v3 API', async () => {
    setEnv({ SENDGRID_API_KEY: 'SG.test_abc', EMAIL_FROM: 'Test <test@example.com>' });
    const p = createProvider('sendgrid');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers({ 'x-message-id': 'sg_msg_456' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await p.send({
      to: 'user@test.com',
      subject: 'Hello',
      text: 'World',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('sg_msg_456');
    expect(result.provider).toBe('sendgrid');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(opts.headers.Authorization).toBe('Bearer SG.test_abc');

    const body = JSON.parse(opts.body);
    expect(body.personalizations[0].to[0].email).toBe('user@test.com');
    expect(body.from.email).toBe('test@example.com');
    expect(body.from.name).toBe('Test');
    expect(body.subject).toBe('Hello');
  });

  it('handles SendGrid API errors', async () => {
    setEnv({ SENDGRID_API_KEY: 'SG.test_abc' });
    const p = createProvider('sendgrid');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad request'),
    }));

    const result = await p.send({ to: 'bad', subject: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('SendGrid 400');
  });
});

// ---------------------------------------------------------------------------
// createProvider — smtp
// ---------------------------------------------------------------------------

describe('smtp provider', () => {
  it('returns error when SMTP credentials are missing', async () => {
    const p = createProvider('smtp');
    expect(p.name).toBe('smtp');

    const result = await p.send({ to: 'user@test.com', subject: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('SMTP not configured');
  });
});

// ---------------------------------------------------------------------------
// getProvider — singleton behavior
// ---------------------------------------------------------------------------

describe('getProvider', () => {
  it('returns the same instance on repeated calls', () => {
    const a = getProvider();
    const b = getProvider();
    expect(a).toBe(b);
  });

  it('creates a new instance after resetProvider()', () => {
    const a = getProvider();
    resetProvider();
    const b = getProvider();
    // Both will be console providers but they are different instances
    expect(a.name).toBe('console');
    expect(b.name).toBe('console');
    expect(a).not.toBe(b);
  });

  it('picks up env var changes after reset', () => {
    const a = getProvider();
    expect(a.name).toBe('console');

    setEnv({ RESEND_API_KEY: 're_test' });
    resetProvider();
    const b = getProvider();
    expect(b.name).toBe('resend');
  });
});
