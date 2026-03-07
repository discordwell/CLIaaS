import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import * as linkStore from '@/lib/integrations/link-store';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const auth = await requirePerm(request, 'customers:edit');
  if ('error' in auth) return auth.error;

  const { linkId } = await params;
  const link = await linkStore.getCrmLink(linkId);
  if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 });

  // Scope by workspace to prevent cross-workspace deletion
  const workspaceId = auth.user.workspaceId ?? 'default';
  if (link.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Link not found' }, { status: 404 });
  }

  linkStore.deleteCrmLink(linkId);
  return NextResponse.json({ ok: true });
}
