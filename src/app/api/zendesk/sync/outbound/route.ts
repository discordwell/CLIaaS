import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { pushZendeskOutboundTickets } from "@/lib/zendesk/outbound";
import { requirePerm } from '@/lib/rbac';

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const tenant = process.env.CLIAAS_TENANT ?? "default";
  const workspace = process.env.CLIAAS_WORKSPACE ?? "default";

  try {
    const result = await pushZendeskOutboundTickets({ tenant, workspace });
    return NextResponse.json({ status: "ok", ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sync failed" },
      { status: 500 },
    );
  }
}
