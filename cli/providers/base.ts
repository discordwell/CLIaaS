import type { Ticket, Message, KBArticle, TriageResult, KBSuggestion } from '../schema/types.js';

/** Strip markdown code fences and parse JSON from LLM output */
export function parseLLMJson<T>(raw: string): T {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return JSON.parse(cleaned) as T;
}

export interface LLMProvider {
  name: string;
  complete(prompt: string): Promise<string>;
  generateReply(ticket: Ticket, messages: Message[], opts?: { tone?: string; context?: string }): Promise<string>;
  triageTicket(ticket: Ticket, messages: Message[]): Promise<TriageResult>;
  suggestKB(ticket: Ticket, articles: KBArticle[]): Promise<KBSuggestion[]>;
  summarize(tickets: Ticket[], period?: string): Promise<string>;
}

export function buildTicketContext(ticket: Ticket, messages: Message[]): string {
  const thread = messages
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map(m => `[${m.type.toUpperCase()}] ${m.author} (${m.createdAt}):\n${m.body}`)
    .join('\n\n---\n\n');

  return `Subject: ${ticket.subject}
Status: ${ticket.status} | Priority: ${ticket.priority}
Requester: ${ticket.requester} | Assignee: ${ticket.assignee ?? 'Unassigned'}
Tags: ${ticket.tags.join(', ') || 'none'}
Created: ${ticket.createdAt}

--- CONVERSATION ---
${thread}`;
}

export function buildTriagePrompt(ticket: Ticket, messages: Message[]): string {
  const context = buildTicketContext(ticket, messages);
  return `You are a helpdesk triage specialist. Analyze this support ticket and provide a triage assessment.

${context}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "ticketId": "${ticket.id}",
  "suggestedPriority": "low|normal|high|urgent",
  "suggestedAssignee": "suggested team or person or null",
  "suggestedCategory": "category name",
  "reasoning": "brief explanation"
}`;
}

export function buildReplyPrompt(ticket: Ticket, messages: Message[], opts?: { tone?: string; context?: string }): string {
  const context = buildTicketContext(ticket, messages);
  const tone = opts?.tone ?? 'professional';
  const extra = opts?.context ? `\n\nAdditional context/KB reference:\n${opts.context}` : '';

  return `You are a customer support agent. Draft a reply to this support ticket.

Tone: ${tone}
${context}${extra}

Write ONLY the reply text, ready to send. Do not include any meta-commentary.`;
}

export function buildKBSuggestPrompt(ticket: Ticket, articles: KBArticle[]): string {
  const articleSummaries = articles
    .map((a, i) => `[${i + 1}] ID: ${a.id} | Title: ${a.title}\n${a.body.slice(0, 300)}...`)
    .join('\n\n');

  return `You are a helpdesk KB specialist. A customer submitted this ticket:

Subject: ${ticket.subject}
Tags: ${ticket.tags.join(', ') || 'none'}

Here are available KB articles:
${articleSummaries}

Suggest the most relevant articles. Respond with ONLY a JSON array (no markdown):
[
  { "articleId": "id", "title": "title", "relevanceScore": 0.0-1.0, "reasoning": "why relevant" }
]`;
}

export function buildRagReplyPrompt(
  ticket: Ticket,
  messages: Message[],
  ragContext: string,
  opts?: { tone?: string },
): string {
  const context = buildTicketContext(ticket, messages);
  const tone = opts?.tone ?? 'professional';

  return `You are a customer support agent. Draft a reply to this support ticket using the retrieved knowledge base context below.

Tone: ${tone}
${context}

${ragContext}

Instructions:
- Use the retrieved context to provide an accurate, helpful reply
- Cite source titles when referencing specific information
- If the context doesn't cover the customer's question, acknowledge what you can help with and what needs escalation
- Write ONLY the reply text, ready to send`;
}

export function buildRagAskPrompt(question: string, ragContext: string): string {
  return `You are a knowledgeable support assistant. Answer the following question using ONLY the provided context. If the context doesn't contain enough information, say so clearly.

Cite your sources by referencing the source titles when using information from them.

${ragContext}

## Question
${question}

Provide a clear, helpful answer based on the context above.`;
}

export function buildSummarizePrompt(tickets: Ticket[], period?: string): string {
  const stats = {
    total: tickets.length,
    open: tickets.filter(t => t.status === 'open').length,
    pending: tickets.filter(t => t.status === 'pending').length,
    solved: tickets.filter(t => t.status === 'solved').length,
    highPriority: tickets.filter(t => t.priority === 'high' || t.priority === 'urgent').length,
  };

  const notable = tickets
    .filter(t => t.priority === 'high' || t.priority === 'urgent')
    .slice(0, 10)
    .map(t => `- [${t.priority.toUpperCase()}] ${t.subject} (${t.status})`)
    .join('\n');

  return `You are a shift manager reviewing the support queue. Summarize the current state.

Period: ${period ?? 'current'}
Stats: ${JSON.stringify(stats)}

Notable tickets:
${notable || 'None'}

Provide a concise shift summary (3-5 bullet points) covering volume, trends, and items needing attention.`;
}
