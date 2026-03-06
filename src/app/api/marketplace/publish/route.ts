import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { upsertListing } from '@/lib/plugins/marketplace-store';
import type { PluginManifestV2 } from '@/lib/plugins/types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  try {
    const parsed = await parseJsonBody<{
      manifest?: PluginManifestV2;
      featured?: boolean;
    }>(request);
    if ('error' in parsed) return parsed.error;

    const { manifest, featured } = parsed.data;

    if (!manifest?.id || !manifest?.name || !manifest?.version) {
      return NextResponse.json(
        { error: 'manifest.id, manifest.name, and manifest.version are required' },
        { status: 400 }
      );
    }

    const listing = await upsertListing({
      pluginId: manifest.id,
      manifest,
      status: 'published',
      featured,
    });

    return NextResponse.json({ listing }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to publish plugin' },
      { status: 500 }
    );
  }
}
