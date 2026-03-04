/**
 * Unified email provider abstraction.
 *
 * Supports multiple backends selected via EMAIL_PROVIDER env var:
 *   - "resend"   — Resend API (fetch-based, modern default)
 *   - "sendgrid"  — SendGrid v3 API (fetch-based)
 *   - "smtp"     — SMTP via nodemailer (self-hosted / BYOC fallback)
 *   - "console"  — Log to stdout (default when nothing is configured)
 *
 * When EMAIL_PROVIDER is unset the code auto-detects based on which
 * credentials are present, falling back to console logging.
 */

import { createLogger } from '../logger';

const logger = createLogger('email:provider');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EmailMessage {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: ProviderName;
}

export type ProviderName = 'resend' | 'sendgrid' | 'smtp' | 'console';

export interface EmailProvider {
  readonly name: ProviderName;
  send(message: EmailMessage): Promise<SendResult>;
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

/** Resend — https://resend.com/docs/api-reference/emails/send-email */
function createResendProvider(apiKey: string): EmailProvider {
  return {
    name: 'resend',
    async send(msg) {
      const from = msg.from || process.env.EMAIL_FROM || 'CLIaaS <noreply@cliaas.com>';
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [msg.to],
            subject: msg.subject,
            text: msg.text,
            html: msg.html,
            reply_to: msg.replyTo,
            headers: msg.headers,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          return { success: false, error: `Resend ${res.status}: ${body}`, provider: 'resend' };
        }

        const data = (await res.json()) as { id?: string };
        return { success: true, messageId: data.id, provider: 'resend' };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Resend request failed',
          provider: 'resend',
        };
      }
    },
  };
}

/** SendGrid v3 Mail Send — https://docs.sendgrid.com/api-reference/mail-send/mail-send */
function createSendGridProvider(apiKey: string): EmailProvider {
  return {
    name: 'sendgrid',
    async send(msg) {
      const from = msg.from || process.env.EMAIL_FROM || 'CLIaaS <noreply@cliaas.com>';
      const parsedFrom = parseEmailAddress(from);
      try {
        const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: msg.to }] }],
            from: parsedFrom,
            subject: msg.subject,
            content: [
              ...(msg.text ? [{ type: 'text/plain', value: msg.text }] : []),
              ...(msg.html ? [{ type: 'text/html', value: msg.html }] : []),
            ],
            ...(msg.replyTo ? { reply_to: parseEmailAddress(msg.replyTo) } : {}),
            ...(msg.headers ? { headers: msg.headers } : {}),
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          return { success: false, error: `SendGrid ${res.status}: ${body}`, provider: 'sendgrid' };
        }

        // SendGrid returns 202 with x-message-id header
        const messageId = res.headers.get('x-message-id') ?? undefined;
        return { success: true, messageId, provider: 'sendgrid' };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'SendGrid request failed',
          provider: 'sendgrid',
        };
      }
    },
  };
}

/** SMTP via nodemailer — self-hosted fallback for BYOC users */
function createSmtpProvider(): EmailProvider {
  return {
    name: 'smtp',
    async send(msg) {
      const host = process.env.SMTP_HOST;
      const port = Number(process.env.SMTP_PORT || '587');
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;

      if (!host || !user || !pass) {
        return { success: false, error: 'SMTP not configured (missing SMTP_HOST, SMTP_USER, or SMTP_PASS)', provider: 'smtp' };
      }

      try {
        const nodemailer = await import('nodemailer');
        const transport = nodemailer.default.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
        });

        const from = msg.from || process.env.SMTP_FROM || process.env.EMAIL_FROM || `CLIaaS <noreply@cliaas.com>`;

        const result = await transport.sendMail({
          from,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          replyTo: msg.replyTo,
          headers: msg.headers,
        });

        return { success: true, messageId: result.messageId, provider: 'smtp' };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'SMTP send failed',
          provider: 'smtp',
        };
      }
    },
  };
}

/** Console provider — logs to stdout. Default when no provider is configured. */
function createConsoleProvider(): EmailProvider {
  return {
    name: 'console',
    async send(msg) {
      logger.info(
        { to: msg.to, subject: msg.subject, from: msg.from },
        'Email (console-only, no provider configured)',
      );
      return { success: true, messageId: `console-${Date.now()}`, provider: 'console' };
    },
  };
}

// ---------------------------------------------------------------------------
// Auto-detection & singleton
// ---------------------------------------------------------------------------

/**
 * Determine which provider to use. Priority:
 * 1. Explicit EMAIL_PROVIDER env var
 * 2. Auto-detect based on available credentials
 * 3. Fall back to console
 */
export function resolveProviderName(): ProviderName {
  const explicit = process.env.EMAIL_PROVIDER?.toLowerCase().trim();
  if (explicit === 'resend' || explicit === 'sendgrid' || explicit === 'smtp' || explicit === 'console') {
    return explicit;
  }

  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SENDGRID_API_KEY) return 'sendgrid';
  if (process.env.SMTP_HOST && process.env.SMTP_USER) return 'smtp';
  return 'console';
}

export function createProvider(name?: ProviderName): EmailProvider {
  const providerName = name ?? resolveProviderName();

  switch (providerName) {
    case 'resend': {
      const key = process.env.RESEND_API_KEY;
      if (!key) {
        logger.warn('EMAIL_PROVIDER=resend but RESEND_API_KEY is missing, falling back to console');
        return createConsoleProvider();
      }
      return createResendProvider(key);
    }
    case 'sendgrid': {
      const key = process.env.SENDGRID_API_KEY;
      if (!key) {
        logger.warn('EMAIL_PROVIDER=sendgrid but SENDGRID_API_KEY is missing, falling back to console');
        return createConsoleProvider();
      }
      return createSendGridProvider(key);
    }
    case 'smtp':
      return createSmtpProvider();
    case 'console':
      return createConsoleProvider();
    default:
      return createConsoleProvider();
  }
}

// Cached singleton — resolved once per process lifetime
let _cachedProvider: EmailProvider | null = null;

export function getProvider(): EmailProvider {
  if (!_cachedProvider) {
    _cachedProvider = createProvider();
    logger.info({ provider: _cachedProvider.name }, 'Email provider initialized');
  }
  return _cachedProvider;
}

/**
 * Reset the cached provider. Useful in tests or after env var changes.
 */
export function resetProvider(): void {
  _cachedProvider = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "Name <email>" format into { email, name } for SendGrid. */
function parseEmailAddress(addr: string): { email: string; name?: string } {
  const match = addr.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  return { email: addr.trim() };
}
