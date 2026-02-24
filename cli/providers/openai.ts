import OpenAI from 'openai';
import type { LLMProvider } from './base.js';
import { parseLLMJson, buildTriagePrompt, buildReplyPrompt, buildKBSuggestPrompt, buildSummarizePrompt } from './base.js';
import type { Ticket, Message, KBArticle } from '@/lib/data-provider/types.js';
import type { TriageResult, KBSuggestion } from '../schema/types.js';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model ?? 'gpt-4o';
  }

  async complete(prompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.choices[0]?.message?.content ?? '';
  }

  async generateReply(ticket: Ticket, messages: Message[], opts?: { tone?: string; context?: string }): Promise<string> {
    return this.complete(buildReplyPrompt(ticket, messages, opts));
  }

  async triageTicket(ticket: Ticket, messages: Message[]): Promise<TriageResult> {
    const raw = await this.complete(buildTriagePrompt(ticket, messages));
    try {
      return parseLLMJson<TriageResult>(raw);
    } catch {
      return { ticketId: ticket.id, suggestedPriority: 'normal', suggestedCategory: 'unknown', reasoning: raw.slice(0, 200) };
    }
  }

  async suggestKB(ticket: Ticket, articles: KBArticle[]): Promise<KBSuggestion[]> {
    const raw = await this.complete(buildKBSuggestPrompt(ticket, articles));
    try {
      return parseLLMJson<KBSuggestion[]>(raw);
    } catch {
      return [];
    }
  }

  async summarize(tickets: Ticket[], period?: string): Promise<string> {
    return this.complete(buildSummarizePrompt(tickets, period));
  }
}
