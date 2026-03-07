import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PluginRegistry } from '@/lib/plugins';
import { getInstallation, updateInstallation, uninstallPlugin } from '@/lib/plugins/store';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    // Try new store first
    const installation = await getInstallation(id);
    if (installation) {
      return NextResponse.json({ installation });
    }

    // Fall back to legacy registry
    const plugin = PluginRegistry.getPlugin(id);
    if (!plugin) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
    }
    return NextResponse.json({ plugin });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to get plugin') },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    const parsed = await parseJsonBody<{
      enabled?: boolean;
      config?: Record<string, unknown>;
    }>(request);
    if ('error' in parsed) return parsed.error;

    const updated = await updateInstallation(id, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: 'Plugin installation not found' }, { status: 404 });
    }
    return NextResponse.json({ installation: updated });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update plugin') },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    // Try new store first
    const uninstalled = await uninstallPlugin(id);
    if (uninstalled) {
      return NextResponse.json({ ok: true });
    }

    // Fall back to legacy registry
    const deleted = PluginRegistry.unregister(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to unregister plugin') },
      { status: 500 }
    );
  }
}
