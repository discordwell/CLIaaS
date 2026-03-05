import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSlackClientId } from '@/lib/channels/slack-intake';

export const dynamic = 'force-dynamic';

/**
 * GET /api/channels/slack/oauth
 * Redirects the user to Slack's OAuth authorization page.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const clientId = getSlackClientId();

  if (!clientId) {
    return NextResponse.json(
      { error: 'Slack OAuth not configured. Set SLACK_CLIENT_ID environment variable.' },
      { status: 503 },
    );
  }

  // Build the OAuth URL
  const scopes = [
    'channels:history',
    'channels:read',
    'chat:write',
    'commands',
    'groups:history',
    'groups:read',
    'im:history',
    'im:read',
    'im:write',
    'users:read',
  ].join(',');

  const { searchParams } = new URL(request.url);
  const redirectUri = searchParams.get('redirect_uri')
    ?? `${new URL(request.url).origin}/api/channels/slack/oauth/callback`;

  const oauthUrl = new URL('https://slack.com/oauth/v2/authorize');
  oauthUrl.searchParams.set('client_id', clientId);
  oauthUrl.searchParams.set('scope', scopes);
  oauthUrl.searchParams.set('redirect_uri', redirectUri);

  return NextResponse.json({
    url: oauthUrl.toString(),
    message: 'Redirect the user to this URL to start the Slack OAuth flow.',
  });
}
