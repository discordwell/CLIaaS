import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { redactDetection, redactAllConfirmed } from '@/lib/compliance/pii-masking';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { detectionId, allConfirmed } = parsed.data;

    if (!detectionId && !allConfirmed) {
      return NextResponse.json(
        { error: 'Either detectionId or allConfirmed: true is required' },
        { status: 400 },
      );
    }

    if (allConfirmed) {
      const count = await redactAllConfirmed(auth.user.workspaceId, auth.user.id);
      return NextResponse.json({ success: true, count });
    }

    await redactDetection(detectionId, auth.user.id, auth.user.workspaceId);
    return NextResponse.json({ success: true, count: 1 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to redact PII' },
      { status: 500 },
    );
  }
}
