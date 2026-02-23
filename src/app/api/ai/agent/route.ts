import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadTickets, loadMessages, loadKBArticles } from '@/lib/data';
import {
  runAgent,
  getAgentStats,
  DEFAULT_AGENT_CONFIG,
  type AIAgentConfig,
} from '@/lib/ai/agent';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ai/agent - Return AI agent config and stats
 */
export async function GET() {
  const stats = getAgentStats();

  return NextResponse.json({
    config: DEFAULT_AGENT_CONFIG,
    stats: {
      ...stats,
      resolutionRate:
        stats.totalRuns > 0
          ? Math.round((stats.resolved / stats.totalRuns) * 100)
          : 0,
      escalationRate:
        stats.totalRuns > 0
          ? Math.round((stats.escalated / stats.totalRuns) * 100)
          : 0,
    },
  });
}

/**
 * POST /api/ai/agent - Run AI agent on a ticket
 *
 * Body: {
 *   ticketId: string;          // required
 *   dryRun?: boolean;          // default true
 *   config?: Partial<AIAgentConfig>;
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody<{
      ticketId?: string;
      dryRun?: boolean;
      config?: Partial<AIAgentConfig>;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { ticketId, dryRun = true, config: configOverrides } = parsed.data;

    if (!ticketId) {
      return NextResponse.json(
        { error: 'ticketId is required' },
        { status: 400 },
      );
    }

    // Check for API keys
    const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    if (!hasAnthropic && !hasOpenAI) {
      return NextResponse.json(
        {
          error:
            'No LLM API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.',
        },
        { status: 503 },
      );
    }

    // Load ticket data
    const tickets = await loadTickets();
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      return NextResponse.json(
        { error: `Ticket "${ticketId}" not found` },
        { status: 404 },
      );
    }

    const messages = await loadMessages(ticketId);
    const kbArticles = await loadKBArticles();

    // Build config
    const config: AIAgentConfig = {
      ...DEFAULT_AGENT_CONFIG,
      ...configOverrides,
      provider: hasAnthropic ? 'claude' : 'openai',
    };

    const result = await runAgent({
      ticket,
      messages,
      kbArticles,
      config,
      dryRun,
    });

    return NextResponse.json({
      result,
      dryRun,
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'AI agent failed',
      },
      { status: 500 },
    );
  }
}
