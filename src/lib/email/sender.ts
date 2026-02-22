import nodemailer from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
  from?: string;
}

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const transport = getTransport();
  if (!transport) {
    console.log('[email] SMTP not configured. Would send:', {
      to: options.to,
      subject: options.subject,
    });
    return { success: true, messageId: `mock-${Date.now()}` };
  }

  try {
    const from = options.from || process.env.SMTP_FROM || `CLIaaS <noreply@${process.env.NEXT_PUBLIC_BASE_URL?.replace(/https?:\/\//, '') || 'cliaas.com'}>`;

    const result = await transport.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      replyTo: options.replyTo,
      headers: {
        ...(options.inReplyTo ? { 'In-Reply-To': options.inReplyTo } : {}),
        ...(options.references ? { References: options.references } : {}),
      },
    });

    return { success: true, messageId: result.messageId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Send failed',
    };
  }
}

export async function sendTicketReply(params: {
  ticketId: string;
  customerEmail: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  agentName?: string;
  originalMessageId?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const domain = process.env.NEXT_PUBLIC_BASE_URL?.replace(/https?:\/\//, '') || 'cliaas.com';
  const threadId = `<ticket-${params.ticketId}@${domain}>`;

  return sendEmail({
    to: params.customerEmail,
    subject: params.subject.startsWith('Re:') ? params.subject : `Re: ${params.subject}`,
    text: params.body,
    html: params.bodyHtml || `<div>${params.body.replace(/\n/g, '<br>')}</div>`,
    inReplyTo: params.originalMessageId || threadId,
    references: [threadId, params.originalMessageId].filter(Boolean).join(' '),
    from: params.agentName
      ? `${params.agentName} via CLIaaS <noreply@${domain}>`
      : undefined,
  });
}

export async function sendNotification(params: {
  to: string;
  template: string;
  data: Record<string, unknown>;
}): Promise<{ success: boolean; error?: string }> {
  const subjects: Record<string, string> = {
    escalation: `[CLIaaS] Ticket escalated: ${params.data.subject || 'Unknown'}`,
    sla_breach: `[CLIaaS] SLA breach: ${params.data.subject || 'Unknown'}`,
    assignment: `[CLIaaS] Ticket assigned to you: ${params.data.subject || 'Unknown'}`,
    new_ticket: `[CLIaaS] New ticket: ${params.data.subject || 'Unknown'}`,
  };

  return sendEmail({
    to: params.to,
    subject: subjects[params.template] || `[CLIaaS] Notification`,
    text: `${params.template}: ${JSON.stringify(params.data, null, 2)}`,
    html: `<h3>${params.template}</h3><pre>${JSON.stringify(params.data, null, 2)}</pre>`,
  });
}
