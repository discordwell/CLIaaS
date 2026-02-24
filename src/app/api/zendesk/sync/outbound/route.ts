import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { pushZendeskOutboundTickets } from "@/lib/zendesk/outbound";
import { requireRole } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
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
