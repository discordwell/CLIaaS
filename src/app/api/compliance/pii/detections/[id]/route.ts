import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { reviewDetection } from '@/lib/compliance/pii-masking';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  const { id } = await params;

  try {
    const { action } = parsed.data;

    if (!action || !['confirm', 'dismiss'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "confirm" or "dismiss"' },
        { status: 400 },
      );
    }

    await reviewDetection(id, action, auth.user.id, auth.user.workspaceId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to review detection' },
      { status: 500 },
    );
  }
}
