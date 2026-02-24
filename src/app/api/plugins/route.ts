import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PluginRegistry } from '@/lib/plugins';
import { requireRole } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const plugins = PluginRegistry.list();
    return NextResponse.json({ plugins });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list plugins' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
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

    // Check for duplicate
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
      { error: err instanceof Error ? err.message : 'Failed to register plugin' },
      { status: 500 }
    );
  }
}
