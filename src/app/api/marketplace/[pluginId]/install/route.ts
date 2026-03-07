import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { getListing, incrementInstallCount } from '@/lib/plugins/marketplace-store';
import { installPlugin, getInstallationByPluginId } from '@/lib/plugins/store';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pluginId: string }> }
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { pluginId } = await params;

  try {
    const listing = await getListing(pluginId);
    if (!listing) {
      return NextResponse.json({ error: 'Plugin not found in marketplace' }, { status: 404 });
    }

    if (listing.status !== 'published') {
      return NextResponse.json({ error: 'Plugin is not published' }, { status: 400 });
    }

    // Check if already installed
    const existing = await getInstallationByPluginId(pluginId);
    if (existing) {
      return NextResponse.json({ error: 'Plugin already installed' }, { status: 409 });
    }

    // Parse optional config
    let config: Record<string, unknown> = {};
    try {
      const parsed = await parseJsonBody<{ config?: Record<string, unknown> }>(request);
      if (!('error' in parsed) && parsed.data.config) {
        config = parsed.data.config;
      }
    } catch {
      // No body is fine
    }

    const installation = await installPlugin({
      pluginId,
      version: listing.manifest.version,
      config,
      hooks: listing.manifest.hooks,
    });

    await incrementInstallCount(pluginId);

    return NextResponse.json({ installation }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to install plugin') },
      { status: 500 }
    );
  }
}
