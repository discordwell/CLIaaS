/**
 * POST /api/wfm/volume/collect
 * Trigger a real volume snapshot collection for a workspace.
 * Requires 'admin:settings' permission.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { collectVolumeSnapshot } from '@/lib/wfm/volume-collector';

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const workspaceId = auth.user.workspaceId ?? 'default';

  try {
    const snapshot = await collectVolumeSnapshot(workspaceId);
    return NextResponse.json(snapshot, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Collection failed' },
      { status: 500 },
    );
  }
}
