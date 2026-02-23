import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult, safeGetProvider, safeLoadTickets, safeLoadMessages, getTicketMessages, findTicket } from '../util.js';
import { parseLLMJson } from '../../providers/base.js';
import type { Ticket } from '../../schema/types.js';

export function registerAnalysisTools(server: McpServer): void {
  server.tool(
    'triage_ticket',
    'LLM-powered triage for a single ticket — suggests priority, category, and assignee',
    {
      ticketId: z.string().describe('Ticket ID or external ID'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ ticketId, dir }) => {
      const result = safeGetProvider();
      if ('error' in result) return errorResult(result.error);

      const tickets = safeLoadTickets(dir);
      const messages = safeLoadMessages(dir);

      const ticket = findTicket(tickets, ticketId);
      if (!ticket) return errorResult(`Ticket not found: ${ticketId}`);

      const msgs = getTicketMessages(ticket.id, messages);
      try {
        const triage = await result.provider.triageTicket(ticket, msgs);
        return textResult(triage);
      } catch (err) {
        return errorResult(`Triage failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'triage_batch',
    'LLM-powered batch triage — triage multiple tickets filtered by status',
    {
      status: z.string().default('open').describe('Filter tickets by status'),
      limit: z.number().default(10).describe('Max tickets to triage'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ status, limit, dir }) => {
      const result = safeGetProvider();
      if ('error' in result) return errorResult(result.error);

      const tickets = safeLoadTickets(dir);
      const messages = safeLoadMessages(dir);

      const queue = tickets.filter(t => t.status === status).slice(0, limit);
      if (queue.length === 0) return errorResult(`No ${status} tickets found.`);

      const results = [];
      for (const ticket of queue) {
        try {
          const msgs = getTicketMessages(ticket.id, messages);
          const triage = await result.provider.triageTicket(ticket, msgs);
          results.push(triage);
        } catch (err) {
          results.push({
            ticketId: ticket.id,
            error: err instanceof Error ? err.message : 'Triage failed',
          });
        }
      }

      return textResult({ triaged: results.length, results });
    },
  );

  server.tool(
    'draft_reply',
    'Draft an AI-generated reply to a ticket, optionally using RAG knowledge base context',
    {
      ticketId: z.string().describe('Ticket ID or external ID'),
      tone: z.string().default('professional').describe('Tone: professional, concise, friendly, formal'),
      useRag: z.boolean().default(false).describe('Use RAG retrieval for context'),
      ragTopK: z.number().default(5).describe('Number of RAG chunks to retrieve'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ ticketId, tone, useRag, ragTopK, dir }) => {
      const result = safeGetProvider();
      if ('error' in result) return errorResult(result.error);

      const tickets = safeLoadTickets(dir);
      const messages = safeLoadMessages(dir);

      const ticket = findTicket(tickets, ticketId);
      if (!ticket) return errorResult(`Ticket not found: ${ticketId}`);

      const msgs = getTicketMessages(ticket.id, messages);

      if (useRag) {
        try {
          const { retrieve, formatRetrievedContext } = await import('../../rag/retriever.js');
          const ragResults = await retrieve({ query: ticket.subject, topK: ragTopK });
          const context = formatRetrievedContext(ragResults);
          const reply = await result.provider.generateReply(ticket, msgs, { tone, context });
          return textResult({
            ticketId: ticket.id,
            draft: reply,
            ragSources: ragResults.map(r => ({
              title: r.chunk.sourceTitle,
              type: r.chunk.sourceType,
              score: r.combinedScore,
            })),
          });
        } catch (err) {
          return errorResult(`RAG retrieval failed: ${err instanceof Error ? err.message : err}. Try with useRag=false.`);
        }
      }

      try {
        const reply = await result.provider.generateReply(ticket, msgs, { tone });
        return textResult({ ticketId: ticket.id, draft: reply });
      } catch (err) {
        return errorResult(`Draft failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'sentiment_analyze',
    'Analyze customer sentiment across tickets using LLM',
    {
      ticketId: z.string().optional().describe('Analyze a single ticket by ID'),
      status: z.string().default('open').describe('Filter tickets by status (when ticketId not set)'),
      limit: z.number().default(10).describe('Max tickets to analyze'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ ticketId, status, limit, dir }) => {
      const result = safeGetProvider();
      if ('error' in result) return errorResult(result.error);

      const allTickets = safeLoadTickets(dir);
      const allMessages = safeLoadMessages(dir);

      let queue: Ticket[];
      if (ticketId) {
        const ticket = findTicket(allTickets, ticketId);
        if (!ticket) return errorResult(`Ticket not found: ${ticketId}`);
        queue = [ticket];
      } else {
        queue = allTickets.filter(t => t.status === status).slice(0, limit);
      }

      if (queue.length === 0) return errorResult(`No ${status} tickets found.`);

      const results = [];
      for (const ticket of queue) {
        try {
          const messages = getTicketMessages(ticket.id, allMessages);
          const conversation = messages
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            .map(m => `[${m.author}]: ${m.body}`)
            .join('\n\n');

          const prompt = `Analyze the customer sentiment in this support ticket conversation. Return a JSON object with these fields:
- sentiment: one of "positive", "neutral", "frustrated", "angry", "urgent"
- score: number from -100 (very negative) to 100 (very positive)
- summary: one sentence describing the customer's emotional state
- escalation_risk: "low", "medium", or "high"

Ticket: ${ticket.subject}
Priority: ${ticket.priority}
Status: ${ticket.status}

Conversation:
${conversation}

Return ONLY the JSON object, no other text.`;

          const raw = await result.provider.complete(prompt);

          let parsed: { sentiment: string; score: number; summary: string; escalation_risk: string };
          try {
            parsed = parseLLMJson(raw);
          } catch {
            parsed = { sentiment: 'neutral', score: 0, summary: raw.slice(0, 100), escalation_risk: 'medium' };
          }

          results.push({
            ticketId: ticket.id,
            externalId: ticket.externalId,
            subject: ticket.subject,
            sentiment: parsed.sentiment,
            score: parsed.score,
            summary: parsed.summary,
            escalationRisk: parsed.escalation_risk,
          });
        } catch (err) {
          results.push({
            ticketId: ticket.id,
            externalId: ticket.externalId,
            error: err instanceof Error ? err.message : 'Analysis failed',
          });
        }
      }

      const scored = results.filter(r => 'score' in r);
      const avgScore = scored.length > 0
        ? scored.reduce((sum, r) => sum + (r as { score: number }).score, 0) / scored.length
        : 0;

      return textResult({
        analyzed: results.length,
        averageScore: Math.round(avgScore),
        results,
      });
    },
  );

  server.tool(
    'detect_duplicates',
    'Detect potential duplicate tickets using subject line similarity',
    {
      threshold: z.number().default(70).describe('Similarity threshold 0-100'),
      status: z.string().optional().describe('Filter by status'),
      limit: z.number().default(20).describe('Max duplicate groups'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ threshold, status, limit, dir }) => {
      let tickets = safeLoadTickets(dir);
      if (status) tickets = tickets.filter(t => t.status === status);
      if (tickets.length === 0) return errorResult('No tickets found.');

      const thresholdFrac = threshold / 100;
      const groups: Array<{ tickets: Array<{ id: string; externalId: string; subject: string; status: string; priority: string }>; similarity: number }> = [];
      const seen = new Set<string>();

      for (let i = 0; i < tickets.length; i++) {
        if (seen.has(tickets[i].id)) continue;
        const group = [tickets[i]];

        for (let j = i + 1; j < tickets.length; j++) {
          if (seen.has(tickets[j].id)) continue;
          if (similarity(tickets[i].subject, tickets[j].subject) >= thresholdFrac) {
            group.push(tickets[j]);
            seen.add(tickets[j].id);
          }
        }

        if (group.length > 1) {
          let totalSim = 0;
          let pairs = 0;
          for (let a = 0; a < group.length; a++) {
            for (let b = a + 1; b < group.length; b++) {
              totalSim += similarity(group[a].subject, group[b].subject);
              pairs++;
            }
          }
          groups.push({
            tickets: group.map(t => ({
              id: t.id,
              externalId: t.externalId,
              subject: t.subject,
              status: t.status,
              priority: t.priority,
            })),
            similarity: Math.round((totalSim / pairs) * 100),
          });
          seen.add(tickets[i].id);
        }
      }

      groups.sort((a, b) => b.similarity - a.similarity);

      return textResult({
        totalGroups: groups.length,
        showing: Math.min(groups.length, limit),
        groups: groups.slice(0, limit),
      });
    },
  );

  server.tool(
    'summarize_queue',
    'Generate an AI-powered summary of the current support queue',
    {
      period: z.string().default('today').describe('Time period to summarize'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ period, dir }) => {
      const result = safeGetProvider();
      if ('error' in result) return errorResult(result.error);

      const tickets = safeLoadTickets(dir);
      if (tickets.length === 0) return errorResult('No ticket data found.');

      try {
        const summary = await result.provider.summarize(tickets, period);
        return textResult({ period, totalTickets: tickets.length, summary });
      } catch (err) {
        return errorResult(`Summarize failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}

/** Bigram-based Jaccard similarity for subject line comparison. */
function similarity(a: string, b: string): number {
  const ba = bigrams(a.toLowerCase());
  const bb = bigrams(b.toLowerCase());
  if (ba.size === 0 && bb.size === 0) return 1;
  if (ba.size === 0 || bb.size === 0) return 0;
  let intersection = 0;
  for (const bg of ba) {
    if (bb.has(bg)) intersection++;
  }
  const union = ba.size + bb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function bigrams(s: string): Set<string> {
  const result = new Set<string>();
  const clean = s.replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < clean.length - 1; i++) {
    result.add(clean.substring(i, i + 2));
  }
  return result;
}
