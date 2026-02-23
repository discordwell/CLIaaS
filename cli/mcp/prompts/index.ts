import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  server.prompt(
    'triage-workflow',
    'Load the support queue, triage tickets by priority, and draft replies for top-priority items',
    {
      status: z.string().default('open').describe('Ticket status to filter'),
      limit: z.string().default('10').describe('Number of tickets to triage'),
    },
    async ({ status, limit }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `You are a support queue manager. Please perform a full triage workflow:

1. First, use \`queue_stats\` to get an overview of the current queue.
2. Then use \`tickets_list\` with status="${status}" to see the ${limit} most recent tickets.
3. For each ticket that looks like it needs attention, use \`triage_ticket\` to get AI-powered triage recommendations.
4. For the highest-priority tickets (urgent/high), use \`draft_reply\` to prepare responses.
5. Summarize your findings: which tickets need immediate attention, which can wait, and any patterns you notice.

Focus on actionable insights the support team can use right now.`,
        },
      }],
    }),
  );

  server.prompt(
    'draft-reply',
    'Show a ticket, find relevant KB articles, and draft a context-aware reply',
    {
      ticketId: z.string().describe('Ticket ID to draft a reply for'),
      tone: z.string().default('professional').describe('Reply tone'),
    },
    async ({ ticketId, tone }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Please help me draft a reply for ticket ${ticketId}:

1. Use \`tickets_show\` to read the full ticket and conversation thread.
2. Use \`kb_suggest\` (with useRag=true if available) to find relevant knowledge base articles.
3. Use \`draft_reply\` with tone="${tone}" to generate an initial draft.
4. Review the draft against the KB sources and conversation context.
5. Present the final draft along with the KB sources used.

If RAG is available (try \`rag_status\` first), use it for better context matching.`,
        },
      }],
    }),
  );

  server.prompt(
    'shift-handoff',
    'Generate a comprehensive shift handoff report with queue summary, SLA status, and sentiment analysis',
    {
      period: z.string().default('today').describe('Time period to summarize'),
    },
    async ({ period }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Generate a shift handoff report for the incoming support team:

1. Use \`summarize_queue\` with period="${period}" for an AI-generated queue summary.
2. Use \`sla_report\` to check SLA compliance — highlight any breaches or at-risk tickets.
3. Use \`sentiment_analyze\` on open tickets to identify frustrated or angry customers.
4. Use \`queue_stats\` for raw numbers on queue volume and distribution.

Compile everything into a clear handoff report with:
- **Queue Overview**: volume, status distribution, priority breakdown
- **SLA Status**: breached tickets, at-risk tickets, compliance rate
- **Customer Sentiment**: any escalation risks, frustrated customers
- **Action Items**: what the incoming shift should prioritize
- **Notable Tickets**: specific tickets that need attention`,
        },
      }],
    }),
  );

  server.prompt(
    'investigate-customer',
    'Search for all tickets from a customer, show conversation threads, and analyze their support history',
    {
      query: z.string().describe('Customer name, email, or search term'),
    },
    async ({ query }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Investigate the support history for: "${query}"

1. Use \`tickets_search\` to find all related tickets.
2. For each relevant ticket found, use \`tickets_show\` to read the full conversation.
3. Use \`sentiment_analyze\` on the customer's tickets to understand their satisfaction trend.
4. If duplicates exist, use \`detect_duplicates\` to find related issues.

Provide a comprehensive customer report:
- **Ticket History**: all tickets, their statuses, and outcomes
- **Common Issues**: recurring themes or problems
- **Sentiment Trend**: how the customer's satisfaction has changed
- **Recommendations**: how to better serve this customer going forward`,
        },
      }],
    }),
  );
}
