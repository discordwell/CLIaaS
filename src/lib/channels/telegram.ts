/**
 * Telegram Bot API client.
 * Provides methods for sending messages, configuring webhooks, and verifying requests.
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

export async function sendMessage(botToken: string, chatId: string, text: string): Promise<unknown> {
  const res = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  return res.json();
}

export async function setWebhook(botToken: string, url: string, secret: string): Promise<unknown> {
  const res = await fetch(`${TELEGRAM_API}${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secret }),
  });
  return res.json();
}

export async function getMe(botToken: string): Promise<unknown> {
  const res = await fetch(`${TELEGRAM_API}${botToken}/getMe`);
  return res.json();
}

export function verifyWebhookSecret(request: Request, secret: string): boolean {
  const header = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  return header === secret;
}
