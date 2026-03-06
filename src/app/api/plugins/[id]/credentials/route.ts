import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getInstallation, updateInstallation } from '@/lib/plugins/store';
import { encryptCredentials, decryptCredentials } from '@/lib/plugins/credentials';

export const dynamic = 'force-dynamic';

const CREDENTIALS_CONFIG_KEY = '_encryptedCredentials';

/**
 * GET /api/plugins/:id/credentials — retrieve decrypted credentials (admin only)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    const installation = await getInstallation(id);
    if (!installation) {
      return NextResponse.json(
        { error: 'Plugin installation not found' },
        { status: 404 },
      );
    }

    const encrypted = installation.config[CREDENTIALS_CONFIG_KEY] as string | undefined;
    if (!encrypted) {
      return NextResponse.json({ credentials: {} });
    }

    const credentials = decryptCredentials(encrypted);

    // Mask values for display: show only last 4 chars
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(credentials)) {
      masked[key] = value.length > 4
        ? '****' + value.slice(-4)
        : '****';
    }

    return NextResponse.json({ credentials: masked, keys: Object.keys(credentials) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get credentials' },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/plugins/:id/credentials — encrypt and store credentials (admin only)
 * Body: { credentials: Record<string, string> }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const parsed = await parseJsonBody<{
    credentials?: Record<string, string>;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { credentials } = parsed.data;
  if (!credentials || typeof credentials !== 'object') {
    return NextResponse.json(
      { error: 'credentials object is required' },
      { status: 400 },
    );
  }

  // Validate all values are strings
  for (const [key, value] of Object.entries(credentials)) {
    if (typeof value !== 'string') {
      return NextResponse.json(
        { error: `Credential value for "${key}" must be a string` },
        { status: 400 },
      );
    }
  }

  try {
    const installation = await getInstallation(id);
    if (!installation) {
      return NextResponse.json(
        { error: 'Plugin installation not found' },
        { status: 404 },
      );
    }

    const encrypted = encryptCredentials(credentials);
    const updatedConfig = {
      ...installation.config,
      [CREDENTIALS_CONFIG_KEY]: encrypted,
    };

    const updated = await updateInstallation(id, { config: updatedConfig });
    if (!updated) {
      return NextResponse.json(
        { error: 'Failed to update installation' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: `Credentials stored for ${Object.keys(credentials).length} key(s)`,
      keys: Object.keys(credentials),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to store credentials' },
      { status: 500 },
    );
  }
}
