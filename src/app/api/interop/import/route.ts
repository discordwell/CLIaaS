import { NextRequest, NextResponse } from "next/server";
import { getConnector } from "@/lib/connectors";
import { parseJsonBody } from '@/lib/parse-json-body';

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody<Record<string, unknown>>(request);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
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
