import { NextRequest, NextResponse } from "next/server";
import { getConnector } from "@/lib/connectors";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const provider = typeof body.provider === "string" ? body.provider : "zendesk";
  const filePath =
    typeof body.filePath === "string" && body.filePath.trim().length > 0
      ? body.filePath
      : "./exports/provider.json";

  const connector = getConnector(provider);
  if (!connector) {
    return NextResponse.json(
      { error: `Unknown provider: ${provider}` },
      { status: 400 },
    );
  }

  return NextResponse.json({
    operation: "import",
    provider,
    filePath,
    status: "queued",
    command: `cliaas import --from ${provider} --input ${filePath}`,
  });
}
