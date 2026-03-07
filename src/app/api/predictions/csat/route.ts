import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getPredictions, createPrediction } from '@/lib/predictions/csat-prediction-store';
import { predictCSAT } from '@/lib/predictions/csat-predictor';
import { loadTickets, loadMessages } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/predictions/csat — list CSAT predictions
 */
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'analytics:view');
  if ('error' in auth) return auth.error;

  const wsId = auth.user.workspaceId ?? 'default';
  const ticketId = request.nextUrl.searchParams.get('ticketId') ?? undefined;
  const riskLevel = request.nextUrl.searchParams.get('riskLevel') ?? undefined;

  const predictions = await getPredictions({ workspaceId: wsId, ticketId, riskLevel });
  return NextResponse.json({ predictions, total: predictions.length });
}

/**
 * POST /api/predictions/csat — trigger CSAT prediction for a ticket
 */
export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{ ticketId?: string }>(request);
  if ('error' in parsed) return parsed.error;

  const { ticketId } = parsed.data;
  if (!ticketId) {
    return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
  }

  const tickets = await loadTickets();
  const ticket = tickets.find(t => t.id === ticketId);
  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  const messages = await loadMessages(ticketId);
  const result = predictCSAT({ ticket, messages });
  const wsId = auth.user.workspaceId ?? 'default';

  const prediction = createPrediction({
    workspaceId: wsId,
    ticketId,
    predictedScore: result.score,
    confidence: result.confidence,
    riskLevel: result.riskLevel,
    factors: result.factors,
  });

  return NextResponse.json({ prediction }, { status: 201 });
}
