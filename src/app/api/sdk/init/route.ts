import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseJsonBody } from '@/lib/parse-json-body';
import { createSession } from '@/lib/channels/sdk-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { workspaceId, customer } = parsed.data as {
      workspaceId?: string;
      customer?: { name?: string; email?: string; customAttributes?: Record<string, unknown> };
    };

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId is required' },
        { status: 400 },
      );
    }

    // Generate a customerId from customer info or create an anonymous one
    const customerId = customer?.email
      ? `sdk-${Buffer.from(customer.email).toString('base64url').slice(0, 16)}`
      : `sdk-anon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const session = createSession(workspaceId, customerId);

    return NextResponse.json(
      {
        sessionId: session.id,
        customerId: session.customerId,
        token: session.token,
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create session' },
      { status: 500 },
    );
  }
}
