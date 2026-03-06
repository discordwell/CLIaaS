import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { scanEntity } from '@/lib/compliance/pii-masking';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { entityType, entityId } = parsed.data;
    const VALID_ENTITY_TYPES = ['message', 'ticket', 'customer'];

    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: 'entityType and entityId are required' },
        { status: 400 },
      );
    }

    if (!VALID_ENTITY_TYPES.includes(entityType)) {
      return NextResponse.json(
        { error: `entityType must be one of: ${VALID_ENTITY_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    // Always use authenticated user's workspace — never accept from body
    const detections = await scanEntity(entityType, entityId, auth.user.workspaceId);

    return NextResponse.json({ detections });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to scan entity for PII' },
      { status: 500 },
    );
  }
}
