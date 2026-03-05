import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  verifySlackSignature,
  getSlackSigningSecret,
} from '@/lib/channels/slack-intake';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Read the raw body for signature verification
  const rawBody = await request.text();
  const signingSecret = getSlackSigningSecret();

  // Verify Slack signature — fail closed when no signing secret is configured
  if (!signingSecret) {
    return NextResponse.json(
      { error: 'Slack signing secret not configured' },
      { status: 503 },
    );
  }

  const signature = request.headers.get('x-slack-signature') ?? '';
  const timestamp = request.headers.get('x-slack-request-timestamp') ?? '';

  if (!verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Parse form-encoded body (Slack slash commands use application/x-www-form-urlencoded)
  const params = new URLSearchParams(rawBody);
  const command = params.get('command') ?? '';
  const text = params.get('text') ?? '';
  const userId = params.get('user_id') ?? '';
  const userName = params.get('user_name') ?? '';

  // Handle /cliaas command
  if (command === '/cliaas') {
    const args = text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase();

    if (subcommand === 'ticket') {
      const subject = args.slice(1).join(' ') || 'Ticket from Slack';

      // In a full implementation, this would create a ticket via the data provider
      return NextResponse.json({
        response_type: 'ephemeral',
        text: `Ticket created: "${subject}" (requested by @${userName}).\nThis is a demo response — connect a data provider for live ticket creation.`,
      });
    }

    if (subcommand === 'help' || !subcommand) {
      return NextResponse.json({
        response_type: 'ephemeral',
        text: [
          '*CLIaaS Slash Commands*',
          '`/cliaas ticket <subject>` — Create a support ticket',
          '`/cliaas help` — Show this help message',
        ].join('\n'),
      });
    }

    return NextResponse.json({
      response_type: 'ephemeral',
      text: `Unknown subcommand: "${subcommand}". Run \`/cliaas help\` for available commands.`,
    });
  }

  // Unknown command
  return NextResponse.json({
    response_type: 'ephemeral',
    text: `Unknown command: "${command}"`,
  });
}
