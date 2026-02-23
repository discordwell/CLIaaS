import { NextRequest, NextResponse } from "next/server";
import { syncZendeskTicketById } from "@/lib/zendesk/sync";
import { parseJsonBody } from '@/lib/parse-json-body';

function extractTicketId(payload: Record<string, unknown>): string | null {
  const direct = payload.ticket_id ?? payload.ticketId ?? payload.id;
  if (typeof direct === "number") return String(direct);
  if (typeof direct === "string") return direct;

  const ticketObj = payload.ticket as Record<string, unknown> | undefined;
  if (ticketObj) {
    const id = ticketObj.id ?? ticketObj.ticket_id;
    if (typeof id === "number") return String(id);
    if (typeof id === "string") return id;
  }

  return null;
}

function checkSecret(request: NextRequest): boolean {
  const secret = process.env.ZENDESK_WEBHOOK_SECRET;
  if (!secret) return true;
  const header =
    request.headers.get("x-zendesk-webhook-secret") ||
    request.headers.get("x-webhook-secret") ||
    request.headers.get("authorization");
  if (!header) return false;
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length) === secret;
  return header === secret;
}

export async function POST(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody<Record<string, unknown>>(request);
  if ('error' in parsed) return parsed.error;
  const payload = parsed.data;
  const ticketId = extractTicketId(payload);
  const fallbackId = request.nextUrl.searchParams.get("ticket_id");
  const resolvedTicketId = ticketId ?? fallbackId;

  if (!resolvedTicketId) {
    return NextResponse.json({ status: "ignored", reason: "no ticket id" }, { status: 202 });
  }

  const tenant = process.env.CLIAAS_TENANT ?? "default";
  const workspace = process.env.CLIAAS_WORKSPACE ?? "default";

  try {
    await syncZendeskTicketById({
      tenant,
      workspace,
      ticketId: resolvedTicketId,
      rawEvent: payload,
    });
    return NextResponse.json({ status: "ok", ticketId: resolvedTicketId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sync failed" },
      { status: 500 },
    );
  }
}
