// Microsoft Teams integration for CLIaaS

export interface TeamsConfig {
  webhookUrl: string;
  appId?: string;
  appPassword?: string;
}

export interface TeamsMessage {
  title?: string;
  text: string;
  themeColor?: string;
  sections?: Array<{
    activityTitle?: string;
    activitySubtitle?: string;
    facts?: Array<{ name: string; value: string }>;
    text?: string;
  }>;
}

export interface TeamsActivityPayload {
  type: string;
  text: string;
  from: { id: string; name: string };
  channelId: string;
  conversation: { id: string };
  serviceUrl: string;
}

function getConfig(): TeamsConfig {
  return {
    webhookUrl: process.env.TEAMS_WEBHOOK_URL ?? '',
    appId: process.env.TEAMS_APP_ID,
    appPassword: process.env.TEAMS_APP_PASSWORD,
  };
}

export class TeamsIntegration {
  private config: TeamsConfig;

  constructor(config?: Partial<TeamsConfig>) {
    const envConfig = getConfig();
    this.config = { ...envConfig, ...config };
  }

  isConfigured(): boolean {
    return !!this.config.webhookUrl;
  }

  getStatus(): { connected: boolean; webhookUrl: string } {
    return {
      connected: this.isConfigured(),
      webhookUrl: this.config.webhookUrl
        ? this.config.webhookUrl.replace(/\/[^/]{8,}$/, '/****')
        : '',
    };
  }

  async postMessage(message: TeamsMessage): Promise<{ ok: boolean; error?: string }> {
    if (!this.config.webhookUrl) {
      return { ok: false, error: 'Teams webhook URL not configured' };
    }

    const priorityColors: Record<string, string> = {
      urgent: 'FF0000',
      high: 'FF8C00',
      normal: 'FFD700',
      low: 'A0A0A0',
    };

    try {
      const body = {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        themeColor: message.themeColor ?? priorityColors.normal ?? '0076D7',
        summary: message.title ?? 'CLIaaS Notification',
        sections: [
          {
            activityTitle: message.title,
            text: message.text,
            ...(message.sections?.[0] ?? {}),
          },
          ...(message.sections?.slice(1) ?? []),
        ],
      };

      const res = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `Teams API error: ${res.status} ${text}` };
      }

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to post to Teams',
      };
    }
  }

  async sendNotification(opts: {
    title: string;
    message: string;
    ticketId?: string;
    priority?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const priorityColors: Record<string, string> = {
      urgent: 'FF0000',
      high: 'FF8C00',
      normal: 'FFD700',
      low: 'A0A0A0',
    };

    return this.postMessage({
      title: opts.title,
      text: opts.message,
      themeColor: opts.priority ? priorityColors[opts.priority] ?? '0076D7' : '0076D7',
      sections: [
        {
          activityTitle: opts.title,
          activitySubtitle: opts.ticketId ? `Ticket: ${opts.ticketId}` : undefined,
          facts: [
            ...(opts.priority ? [{ name: 'Priority', value: opts.priority }] : []),
            ...(opts.ticketId ? [{ name: 'Ticket ID', value: opts.ticketId }] : []),
          ],
          text: opts.message,
        },
      ],
    });
  }

  async createTicketFromMessage(payload: TeamsActivityPayload): Promise<{
    ticketId: string;
    subject: string;
  }> {
    const ticketId = `teams-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const subject = payload.text || `Ticket from Teams (${payload.from.name})`;

    return { ticketId, subject };
  }

  handleIncomingActivity(payload: TeamsActivityPayload): {
    type: string;
    text: string;
  } {
    const text = payload.text?.trim() ?? '';
    const command = text.split(' ')[0]?.toLowerCase() ?? '';

    switch (command) {
      case 'create':
        return {
          type: 'message',
          text: `Creating ticket: "${text.slice(7).trim() || 'New ticket from Teams'}"...`,
        };
      case 'status':
        return {
          type: 'message',
          text: 'CLIaaS Teams integration is active.',
        };
      default:
        return {
          type: 'message',
          text: 'CLIaaS Commands:\n- `create <subject>` - Create a new ticket\n- `status` - Check integration status',
        };
    }
  }
}

// Singleton instance
let instance: TeamsIntegration | null = null;

export function getTeamsIntegration(): TeamsIntegration {
  if (!instance) {
    instance = new TeamsIntegration();
  }
  return instance;
}
