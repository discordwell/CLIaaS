/**
 * Parse inbound email webhooks from common providers.
 * Supports SendGrid, Postmark, and generic formats.
 */

export interface ParsedEmail {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
    content?: string; // base64
  }>;
}

export function parseSendGridInbound(body: Record<string, unknown>): ParsedEmail {
  return {
    from: String(body.from || ''),
    to: String(body.to || ''),
    subject: String(body.subject || ''),
    textBody: String(body.text || ''),
    htmlBody: body.html ? String(body.html) : undefined,
    messageId: body.headers ? extractHeader(String(body.headers), 'Message-ID') : undefined,
    inReplyTo: body.headers ? extractHeader(String(body.headers), 'In-Reply-To') : undefined,
    references: body.headers ? extractHeader(String(body.headers), 'References') : undefined,
  };
}

export function parsePostmarkInbound(body: Record<string, unknown>): ParsedEmail {
  const fromFull = body.FromFull as { Email?: string; Name?: string } | undefined;
  return {
    from: fromFull?.Email || String(body.From || ''),
    fromName: fromFull?.Name,
    to: String(body.To || ''),
    subject: String(body.Subject || ''),
    textBody: String(body.TextBody || ''),
    htmlBody: body.HtmlBody ? String(body.HtmlBody) : undefined,
    messageId: String(body.MessageID || ''),
    inReplyTo: body.Headers
      ? findHeader(body.Headers as Array<{ Name: string; Value: string }>, 'In-Reply-To')
      : undefined,
    references: body.Headers
      ? findHeader(body.Headers as Array<{ Name: string; Value: string }>, 'References')
      : undefined,
    attachments: Array.isArray(body.Attachments)
      ? (body.Attachments as Array<{ Name: string; ContentType: string; ContentLength: number; Content: string }>).map(a => ({
          filename: a.Name,
          contentType: a.ContentType,
          size: a.ContentLength,
          content: a.Content,
        }))
      : undefined,
  };
}

export function parseGenericInbound(body: Record<string, unknown>): ParsedEmail {
  return {
    from: String(body.from || body.sender || body.From || ''),
    fromName: body.fromName ? String(body.fromName) : undefined,
    to: String(body.to || body.recipient || body.To || ''),
    subject: String(body.subject || body.Subject || ''),
    textBody: String(body.text || body.body || body.TextBody || body.textBody || ''),
    htmlBody: (body.html || body.HtmlBody || body.htmlBody) ? String(body.html || body.HtmlBody || body.htmlBody) : undefined,
    messageId: body.messageId ? String(body.messageId) : undefined,
    inReplyTo: body.inReplyTo ? String(body.inReplyTo) : undefined,
    references: body.references ? String(body.references) : undefined,
  };
}

export function detectProvider(body: Record<string, unknown>): 'sendgrid' | 'postmark' | 'generic' {
  if (body.FromFull || body.TextBody || body.HtmlBody) return 'postmark';
  if (body.envelope || body.charsets || (body.SPF && body.dkim)) return 'sendgrid';
  return 'generic';
}

export function parseInboundEmail(body: Record<string, unknown>): ParsedEmail {
  const provider = detectProvider(body);
  switch (provider) {
    case 'sendgrid': return parseSendGridInbound(body);
    case 'postmark': return parsePostmarkInbound(body);
    default: return parseGenericInbound(body);
  }
}

/**
 * Extract a ticket ID from email references/in-reply-to headers.
 * Looks for pattern: ticket-{uuid}-{timestamp}@domain
 */
export function extractTicketId(inReplyTo?: string, references?: string): string | null {
  const combined = `${inReplyTo || ''} ${references || ''}`;
  const match = combined.match(/ticket-([a-f0-9-]+)-\d+@/);
  return match ? match[1] : null;
}

/**
 * Extract email address from "Name <email>" format.
 */
export function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from.trim();
}

function extractHeader(headers: string, name: string): string | undefined {
  const re = new RegExp(`^${name}:\\s*(.+)$`, 'mi');
  const match = headers.match(re);
  return match ? match[1].trim() : undefined;
}

function findHeader(headers: Array<{ Name: string; Value: string }>, name: string): string | undefined {
  const h = headers.find(h => h.Name.toLowerCase() === name.toLowerCase());
  return h?.Value;
}
