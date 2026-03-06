import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { createVersion, listVersions, restoreVersion } from '@/lib/automation/versioning';

export const dynamic = 'force-dynamic';

/**
 * GET /api/rules/:id/versions — list all versions for a rule
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const workspaceId = auth.user.workspaceId;

  try {
    const versions = await listVersions(id, workspaceId);
    return NextResponse.json({ versions });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list versions' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/rules/:id/versions — restore a version (body: { versionId }) or create a snapshot (body: {})
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'automation:edit');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const workspaceId = auth.user.workspaceId;
  const userId = auth.user.id;

  const parsed = await parseJsonBody<{ versionId?: string }>(request);
  if ('error' in parsed) return parsed.error;

  try {
    if (parsed.data.versionId) {
      // Restore to a specific version
      const restored = await restoreVersion(id, parsed.data.versionId, workspaceId, userId);
      return NextResponse.json({ restored, message: 'Rule restored to version ' + restored.versionNumber });
    }

    // Create a new snapshot of the current state
    const version = await createVersion(id, workspaceId, userId);
    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to process version request' },
      { status: 500 },
    );
  }
}
