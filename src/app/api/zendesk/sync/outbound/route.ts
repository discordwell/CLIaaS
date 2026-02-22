import { NextResponse } from "next/server";
import { pushZendeskOutboundTickets } from "@/lib/zendesk/outbound";

export async function POST() {
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
