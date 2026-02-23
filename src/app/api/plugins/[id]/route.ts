import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PluginRegistry } from '@/lib/plugins';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const plugin = PluginRegistry.getPlugin(id);
    if (!plugin) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
    }
    return NextResponse.json({ plugin });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get plugin' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    const deleted = PluginRegistry.unregister(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to unregister plugin' },
      { status: 500 }
    );
  }
}
