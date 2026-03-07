import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PluginRegistry, getInstallations } from '@/lib/plugins';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');

    // New store-backed installations
    if (source === 'installations') {
      const auth = await requirePerm(request, 'admin:settings');
      if ('error' in auth) return auth.error;
      const installations = await getInstallations(auth.user.workspaceId);
      return NextResponse.json({ installations });
    }

    // Legacy plugin registry (backward compat)
    const plugins = PluginRegistry.list();
    return NextResponse.json({ plugins });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to list plugins') },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  try {
    const parsed = await parseJsonBody<{
        id?: string;
        name?: string;
        version?: string;
        description?: string;
        author?: string;
        hooks?: string[];
        actions?: Array<{ id: string; name: string; description: string }>;
        enabled?: boolean;
        config?: Record<string, unknown>;
      }>(request);
    if ('error' in parsed) return parsed.error;
    const { id, name, version, description, author, hooks, actions, enabled, config } =
      parsed.data;

    if (!id || !name) {
      return NextResponse.json(
        { error: 'id and name are required' },
        { status: 400 }
      );
    }

    if (PluginRegistry.getPlugin(id)) {
      return NextResponse.json(
        { error: `Plugin "${id}" is already registered` },
        { status: 409 }
      );
    }

    const plugin = PluginRegistry.register({
      id,
      name,
      version: version ?? '1.0.0',
      description: description ?? '',
      author: author ?? 'Unknown',
      hooks: (hooks ?? []) as Array<
        | 'ticket.created'
        | 'ticket.updated'
        | 'ticket.resolved'
        | 'message.created'
        | 'sla.breached'
        | 'csat.submitted'
      >,
      actions: actions ?? [],
      enabled: enabled ?? true,
      config,
    });

    return NextResponse.json({ plugin }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to register plugin') },
      { status: 500 }
    );
  }
}
