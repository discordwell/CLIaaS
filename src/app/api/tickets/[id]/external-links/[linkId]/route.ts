import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import * as linkStore from '@/lib/integrations/link-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const { linkId } = await params;
  const link = await linkStore.getExternalLink(linkId);
  if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 });

  // Scope by workspace to prevent cross-workspace data leakage
  const workspaceId = auth.user.workspaceId ?? 'default';
  if (link.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Link not found' }, { status: 404 });
  }

  const comments = await linkStore.listLinkComments(linkId);
  return NextResponse.json({ link, comments });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const auth = await requirePerm(request, 'tickets:update_status');
  if ('error' in auth) return auth.error;

  const { linkId } = await params;
  const link = await linkStore.getExternalLink(linkId);
  if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 });

  // Scope by workspace to prevent cross-workspace deletion
  const workspaceId = auth.user.workspaceId ?? 'default';
  if (link.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Link not found' }, { status: 404 });
  }

  linkStore.deleteExternalLink(linkId);
  return NextResponse.json({ ok: true });
}
