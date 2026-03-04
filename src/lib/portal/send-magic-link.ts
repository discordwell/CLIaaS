/**
 * Send a magic-link email to the portal customer.
 *
 * Uses the unified email provider (Resend / SendGrid / SMTP / console).
 * When no provider is configured the link is logged to stdout (BYOC mode).
 */

import { sendEmail } from '../email/sender';
import { createLogger } from '../logger';

const logger = createLogger('portal:magic-link');

export async function sendMagicLink(email: string, verifyUrl: string): Promise<void> {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || 'CLIaaS';

  const result = await sendEmail({
    to: email,
    subject: `Your ${appName} sign-in link`,
    text: [
      `Hi,`,
      ``,
      `Click the link below to sign in to ${appName}:`,
      ``,
      verifyUrl,
      ``,
      `This link expires in 15 minutes and can only be used once.`,
      ``,
      `If you didn't request this, you can safely ignore this email.`,
    ].join('\n'),
    html: [
      `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">`,
      `  <h2 style="color: #111;">Sign in to ${appName}</h2>`,
      `  <p>Click the button below to sign in:</p>`,
      `  <p style="text-align: center; margin: 24px 0;">`,
      `    <a href="${verifyUrl}" style="background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">`,
      `      Sign In`,
      `    </a>`,
      `  </p>`,
      `  <p style="color: #666; font-size: 13px;">This link expires in 15 minutes and can only be used once.</p>`,
      `  <p style="color: #666; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>`,
      `  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />`,
      `  <p style="color: #999; font-size: 11px;">Sent by ${appName}</p>`,
      `</div>`,
    ].join('\n'),
  });

  if (!result.success) {
    logger.warn({ email, error: result.error }, 'Failed to send magic link email');
  } else {
    logger.info({ email, messageId: result.messageId }, 'Magic link email sent');
  }
}
