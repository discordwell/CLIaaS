import { NextRequest, NextResponse } from "next/server";
import { getConnector } from "@/lib/connectors";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const provider = typeof body.provider === "string" ? body.provider : "zendesk";
  const format = typeof body.format === "string" ? body.format : "json";
  const workspace =
    typeof body.workspace === "string" && body.workspace.trim().length > 0
      ? body.workspace
      : "demo-workspace";

  const connector = getConnector(provider);
  if (!connector) {
    return NextResponse.json(
      { error: `Unknown provider: ${provider}` },
      { status: 400 },
    );
  }

  return NextResponse.json({
    operation: "export",
    workspace,
    provider,
    format,
    status: "queued",
    command: `cliaas export --to ${provider} --workspace ${workspace} --format ${format}`,
  });
}
