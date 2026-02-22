// Slack integration for CLIaaS

export interface SlackConfig {
  webhookUrl: string;
  botToken?: string;
  signingSecret?: string;
  defaultChannel?: string;
}

export interface SlackMessage {
  channel?: string;
  text: string;
  blocks?: Array<Record<string, unknown>>;
}

export interface SlackCommandPayload {
  command: string;
  text: string;
  response_url: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  channel_name: string;
}

function getConfig(): SlackConfig {
  return {
    webhookUrl: process.env.SLACK_WEBHOOK_URL ?? '',
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    defaultChannel: process.env.SLACK_DEFAULT_CHANNEL ?? '#support',
  };
}

export class SlackIntegration {
  private config: SlackConfig;

  constructor(config?: Partial<SlackConfig>) {
    const envConfig = getConfig();
    this.config = { ...envConfig, ...config };
  }

  isConfigured(): boolean {
    return !!this.config.webhookUrl;
  }

  getStatus(): { connected: boolean; webhookUrl: string; defaultChannel: string } {
    return {
      connected: this.isConfigured(),
      webhookUrl: this.config.webhookUrl
        ? this.config.webhookUrl.replace(/\/[^/]{8,}$/, '/****')
        : '',
      defaultChannel: this.config.defaultChannel ?? '#support',
    };
  }

  async postMessage(message: SlackMessage): Promise<{ ok: boolean; error?: string }> {
    if (!this.config.webhookUrl) {
      return { ok: false, error: 'Slack webhook URL not configured' };
    }

    try {
      const res = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: message.channel ?? this.config.defaultChannel,
          text: message.text,
          blocks: message.blocks,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `Slack API error: ${res.status} ${text}` };
      }

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to post to Slack',
      };
    }
  }

  async sendNotification(opts: {
    title: string;
    message: string;
    ticketId?: string;
    priority?: string;
    channel?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const priorityEmoji: Record<string, string> = {
      urgent: ':red_circle:',
      high: ':orange_circle:',
      normal: ':yellow_circle:',
      low: ':white_circle:',
    };

    const emoji = opts.priority
      ? priorityEmoji[opts.priority] ?? ':bell:'
      : ':bell:';

    const text = `${emoji} *${opts.title}*\n${opts.message}${
      opts.ticketId ? `\nTicket: ${opts.ticketId}` : ''
    }`;

    return this.postMessage({ text, channel: opts.channel });
  }

  async createTicketFromMessage(payload: SlackCommandPayload): Promise<{
    ticketId: string;
    subject: string;
  }> {
    // Create a ticket from a Slack slash command
    const ticketId = `slack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const subject = payload.text || `Ticket from Slack (${payload.user_name})`;

    return { ticketId, subject };
  }

  handleSlashCommand(payload: SlackCommandPayload): {
    response_type: 'in_channel' | 'ephemeral';
    text: string;
  } {
    const command = payload.command.replace('/', '');

    switch (command) {
      case 'cliaas':
      case 'ticket': {
        const subcommand = payload.text.split(' ')[0]?.toLowerCase() ?? 'help';
        switch (subcommand) {
          case 'create':
            return {
              response_type: 'ephemeral',
              text: `Creating ticket: "${payload.text.slice(7).trim() || 'New ticket from Slack'}"...`,
            };
          case 'status':
            return {
              response_type: 'ephemeral',
              text: 'CLIaaS is connected and ready. Use `/cliaas create <subject>` to create a ticket.',
            };
          default:
            return {
              response_type: 'ephemeral',
              text: 'CLIaaS Commands:\n- `/cliaas create <subject>` - Create a new ticket\n- `/cliaas status` - Check integration status',
            };
        }
      }
      default:
        return {
          response_type: 'ephemeral',
          text: `Unknown command: ${command}`,
        };
    }
  }
}

// Singleton instance
let instance: SlackIntegration | null = null;

export function getSlackIntegration(): SlackIntegration {
  if (!instance) {
    instance = new SlackIntegration();
  }
  return instance;
}
