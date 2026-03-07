import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSlackClientId, getSlackClientSecret } from '@/lib/channels/slack-intake';

export const dynamic = 'force-dynamic';

/**
 * GET /api/channels/slack/oauth/callback
 * Handles the OAuth callback from Slack, exchanges the code for an access token.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.json(
      { error: `Slack OAuth error: ${error}` },
      { status: 400 },
    );
  }

  if (!code) {
    return NextResponse.json(
      { error: 'Missing authorization code' },
      { status: 400 },
    );
  }

  const clientId = getSlackClientId();
  const clientSecret = getSlackClientSecret();

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'Slack OAuth not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.' },
      { status: 503 },
    );
  }

  // Exchange the code for an access token
  try {
    const redirectUri = `${new URL(request.url).origin}/api/channels/slack/oauth/callback`;

    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await res.json() as {
      ok: boolean;
      access_token?: string;
      team?: { id: string; name: string };
      bot_user_id?: string;
      error?: string;
    };

    if (!data.ok) {
      return NextResponse.json(
        { error: `Slack token exchange failed: ${data.error ?? 'Unknown error'}` },
        { status: 400 },
      );
    }

    // In a full implementation, store the access token in the config
    return NextResponse.json({
      success: true,
      team: data.team,
      botUserId: data.bot_user_id,
      message: 'Slack workspace connected successfully.',
    });
  } catch (err) {
    return NextResponse.json(
      { error: `OAuth callback failed: ${safeErrorMessage(err, 'Unknown error')}` },
      { status: 500 },
    );
  }
}
