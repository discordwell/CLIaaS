import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getTeamsConfig } from '@/lib/channels/teams-intake';

export const dynamic = 'force-dynamic';

/**
 * GET /api/channels/teams/manifest
 * Generate a Teams app manifest JSON for sideloading or publishing.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'channels:view');
  if ('error' in auth) return auth.error;

  const config = getTeamsConfig(auth.user.workspaceId);
  const appId = config?.appId ?? '{{YOUR_APP_ID}}';
  const botName = config?.botName ?? 'CLIaaS Support Bot';

  const manifest = {
    $schema: 'https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json',
    manifestVersion: '1.16',
    version: '1.0.0',
    id: appId,
    developer: {
      name: 'CLIaaS',
      websiteUrl: 'https://cliaas.com',
      privacyUrl: 'https://cliaas.com/privacy',
      termsOfUseUrl: 'https://cliaas.com/terms',
    },
    name: {
      short: botName,
      full: `${botName} — Customer Support Integration`,
    },
    description: {
      short: 'Create and manage support tickets from Teams.',
      full: 'CLIaaS integrates with Microsoft Teams to turn messages into support tickets. Simply message the bot to create a ticket, and your support team will be notified immediately.',
    },
    icons: {
      outline: 'outline.png',
      color: 'color.png',
    },
    accentColor: '#18181B',
    bots: [
      {
        botId: appId,
        scopes: ['personal', 'team', 'groupChat'],
        supportsFiles: false,
        isNotificationOnly: false,
        commandLists: [
          {
            scopes: ['personal', 'team'],
            commands: [
              {
                title: 'ticket',
                description: 'Create a support ticket',
              },
              {
                title: 'status',
                description: 'Check ticket status',
              },
              {
                title: 'help',
                description: 'Show available commands',
              },
            ],
          },
        ],
      },
    ],
    permissions: ['identity', 'messageTeamMembers'],
    validDomains: ['cliaas.com'],
  };

  return NextResponse.json({ manifest });
}
