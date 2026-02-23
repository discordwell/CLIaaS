import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadTickets, loadMessages } from '@/lib/data';
import {
  routeTicket,
  recordAssignment,
  DEFAULT_ROUTING_CONFIG,
  type RoutingConfig,
} from '@/lib/ai/router';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/route - Get routing suggestion for a ticket
 *
 * Body: {
 *   ticketId: string;           // required
 *   useLLM?: boolean;           // default false (keyword matching)
 *   config?: Partial<RoutingConfig>;
 *   apply?: boolean;            // record the assignment in-memory
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody<{
      ticketId?: string;
      useLLM?: boolean;
      config?: Partial<RoutingConfig>;
      apply?: boolean;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const {
      ticketId,
      useLLM = false,
      config: configOverrides,
      apply = false,
    } = parsed.data;

    if (!ticketId) {
      return NextResponse.json(
        { error: 'ticketId is required' },
        { status: 400 },
      );
    }

    // LLM check (only if useLLM is requested)
    if (useLLM) {
      const hasKey = !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY;
      if (!hasKey) {
        return NextResponse.json(
          {
            error:
              'No LLM API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or use useLLM=false for keyword routing.',
          },
          { status: 503 },
        );
      }
    }

    const tickets = await loadTickets();
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      return NextResponse.json(
        { error: `Ticket "${ticketId}" not found` },
        { status: 404 },
      );
    }

    const messages = await loadMessages(ticketId);

    const config: RoutingConfig = {
      ...DEFAULT_ROUTING_CONFIG,
      ...configOverrides,
    };

    const result = await routeTicket(ticket, messages, config, useLLM);

    // Optionally record the assignment
    if (apply && result.suggestedAgentId) {
      recordAssignment(result.suggestedAgentId);
    }

    return NextResponse.json({
      routing: result,
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        currentAssignee: ticket.assignee,
      },
      config: {
        roundRobin: config.roundRobin,
        priorityWeight: config.priorityWeight,
        timezoneAware: config.timezoneAware,
        agentCount: config.skills.length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Routing failed',
      },
      { status: 500 },
    );
  }
}
