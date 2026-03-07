import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { validateSession, updateSessionActivity } from '@/lib/channels/sdk-session';

export const dynamic = 'force-dynamic';

/**
 * Validate the SDK bearer token from Authorization header.
 * Returns the session or a 401 error response.
 */
function requireSDKAuth(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  if (!token) {
    return {
      error: NextResponse.json(
        { error: 'SDK session token required' },
        { status: 401 },
      ),
    };
  }

  const session = validateSession(token);
  if (!session) {
    return {
      error: NextResponse.json(
        { error: 'Invalid or expired session token' },
        { status: 401 },
      ),
    };
  }

  updateSessionActivity(session.id);
  return { session };
}

/**
 * GET /api/sdk/messages — Retrieve messages, optionally since a timestamp.
 */
export async function GET(request: NextRequest) {
  const auth = requireSDKAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const since = searchParams.get('since');

    // In a full implementation, messages would come from the conversation store.
    // For now, return an empty array as a stub that can be extended.
    const messages: Array<{
      id: string;
      body: string;
      authorType: 'customer' | 'agent' | 'bot';
      createdAt: string;
    }> = [];

    if (since) {
      // Filter messages after the given timestamp (stub)
      const sinceTime = new Date(since).getTime();
      return NextResponse.json({
        messages: messages.filter(
          (m) => new Date(m.createdAt).getTime() > sinceTime,
        ),
      });
    }

    return NextResponse.json({ messages });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to get messages') },
      { status: 500 },
    );
  }
}

/**
 * POST /api/sdk/messages — Send a message from the SDK customer.
 */
export async function POST(request: NextRequest) {
  const auth = requireSDKAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { body } = parsed.data as { body?: string };

    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message body is required and must be non-empty' },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const message = {
      id: `sdk-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      body: body.trim(),
      authorType: 'customer' as const,
      createdAt: now,
    };

    return NextResponse.json(message, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to send message') },
      { status: 500 },
    );
  }
}
