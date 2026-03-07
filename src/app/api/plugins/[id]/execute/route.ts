import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { getInstallation } from '@/lib/plugins/store';
import { executePluginHook } from '@/lib/plugins/executor';

export const dynamic = 'force-dynamic';

/**
 * POST /api/plugins/:id/execute — manually trigger a plugin hook
 * Body: { hookName: string, data?: Record<string, unknown> }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const parsed = await parseJsonBody<{
    hookName?: string;
    data?: Record<string, unknown>;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { hookName, data } = parsed.data;
  if (!hookName) {
    return NextResponse.json(
      { error: 'hookName is required' },
      { status: 400 },
    );
  }

  try {
    // Verify the installation exists
    const installation = await getInstallation(id);
    if (!installation) {
      return NextResponse.json(
        { error: 'Plugin installation not found' },
        { status: 404 },
      );
    }

    // Execute the hook manually
    const timestamp = new Date().toISOString();
    await executePluginHook(hookName, {
      event: hookName,
      data: data ?? {},
      timestamp,
      workspaceId: installation.workspaceId,
      pluginId: installation.pluginId,
      config: installation.config,
    });

    return NextResponse.json({
      ok: true,
      message: `Hook "${hookName}" triggered for plugin "${installation.pluginId}"`,
      timestamp,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to execute plugin hook') },
      { status: 500 },
    );
  }
}
