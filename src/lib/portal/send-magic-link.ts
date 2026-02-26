/**
 * Send a magic-link email to the portal customer.
 * Currently logs the URL; integrate an email provider for production.
 */

function createLogger(ns: string) {
  return {
    info: (...args: unknown[]) => {
      if (process.env.NODE_ENV !== 'test') {
        console.info(`[${ns}]`, ...args);
      }
    },
  };
}

const log = createLogger('portal:magic-link');

// TODO: integrate email provider (SendGrid, Postmark, SES, etc.)
export async function sendMagicLink(email: string, verifyUrl: string): Promise<void> {
  log.info(`Magic link for ${email}: ${verifyUrl}`);
}
