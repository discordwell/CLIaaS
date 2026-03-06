import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { logPiiAccess } from '@/lib/compliance/pii-masking';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Agents and above can view unmasked content
  const auth = await requireRole(request, 'agent');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    const db = getDb();
    if (!db) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 503 },
      );
    }

    const [message] = await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.id, id), eq(schema.messages.workspaceId, auth.user.workspaceId)))
      .limit(1);

    if (!message) {
      return NextResponse.json(
        { error: 'Message not found' },
        { status: 404 },
      );
    }

    // Log PII access for audit trail
    await logPiiAccess(
      auth.user.workspaceId,
      auth.user.id,
      'message',
      id,
      'body',
      'unmasked_view',
      'view',
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined,
    );

    return NextResponse.json({
      id: message.id,
      body: message.body,
      bodyHtml: message.bodyHtml,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch unmasked message' },
      { status: 500 },
    );
  }
}
