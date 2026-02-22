import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from './base.js';
import { parseLLMJson, buildTriagePrompt, buildReplyPrompt, buildKBSuggestPrompt, buildSummarizePrompt } from './base.js';
import type { Ticket, Message, KBArticle, TriageResult, KBSuggestion } from '../schema/types.js';

export class ClaudeProvider implements LLMProvider {
  name = 'claude';
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? 'claude-sonnet-4-5-20250929';
  }

  private async complete(prompt: string): Promise<string> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = message.content[0];
    return block.type === 'text' ? block.text : '';
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
