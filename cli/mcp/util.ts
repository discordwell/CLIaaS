import { loadConfig } from '../config.js';
import { ClaudeProvider } from '../providers/claude.js';
import { OpenAIProvider } from '../providers/openai.js';
import { OpenClawProvider } from '../providers/openclaw.js';
import type { LLMProvider } from '../providers/base.js';
import { getDataProvider } from '@/lib/data-provider/index.js';
import type { Ticket, Message, KBArticle } from '@/lib/data-provider/types.js';

export type { Ticket, Message, KBArticle };

/** Write to stderr — safe for MCP stdio servers (never corrupts JSON-RPC on stdout). */
export function log(msg: string): void {
  process.stderr.write(`[cliaas-mcp] ${msg}\n`);
}

/** Build a successful MCP tool result. */
export function textResult(data: unknown) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text' as const, text }] };
}

/** Build an MCP tool error result. */
export function errorResult(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true as const };
}

/**
 * Safe version of getProvider() — returns { provider } or { error } instead of
 * calling process.exit(1) or console.error().
 */
export function safeGetProvider(): { provider: LLMProvider } | { error: string } {
  const config = loadConfig();
  const envClaude = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
  const envOpenAI = process.env.OPENAI_API_KEY;

  switch (config.provider) {
    case 'claude': {
      const apiKey = config.claude?.apiKey ?? envClaude;
      if (!apiKey) {
        return { error: 'No Claude API key configured. Set ANTHROPIC_API_KEY or run: cliaas config set-key claude <key>' };
      }
      return { provider: new ClaudeProvider(apiKey, config.claude?.model) };
    }
    case 'openai': {
      const apiKey = config.openai?.apiKey ?? envOpenAI;
      if (!apiKey) {
        return { error: 'No OpenAI API key configured. Set OPENAI_API_KEY or run: cliaas config set-key openai <key>' };
      }
      return { provider: new OpenAIProvider(apiKey, config.openai?.model) };
    }
    case 'openclaw': {
      const cfg = config.openclaw;
      if (!cfg?.baseUrl) {
        return { error: 'No OpenClaw endpoint configured. Run: cliaas config set-openclaw --base-url <url> --model <model>' };
      }
      return { provider: new OpenClawProvider(cfg.baseUrl, cfg.model, cfg.apiKey) };
    }
    default:
      return { error: `Unknown provider: ${config.provider}` };
  }
}

/** Safe ticket loader — now async, backed by DataProvider. */
export async function safeLoadTickets(dir?: string): Promise<Ticket[]> {
  try {
    const provider = await getDataProvider(dir);
    return await provider.loadTickets();
  } catch {
    return [];
  }
}

/** Safe message loader — now async, backed by DataProvider. */
export async function safeLoadMessages(dir?: string): Promise<Message[]> {
  try {
    const provider = await getDataProvider(dir);
    return await provider.loadMessages();
  } catch {
    return [];
  }
}

/** Safe KB article loader — now async, backed by DataProvider. */
export async function safeLoadKBArticles(dir?: string): Promise<KBArticle[]> {
  try {
    const provider = await getDataProvider(dir);
    return await provider.loadKBArticles();
  } catch {
    return [];
  }
}

/** Find a ticket by ID or external ID. */
export function findTicket(tickets: Ticket[], ticketId: string): Ticket | undefined {
  return tickets.find(t => t.id === ticketId || t.externalId === ticketId);
}

/** Mask API keys in config for safe display. */
export function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...config };
  for (const key of ['claude', 'openai', 'openclaw']) {
    const section = config[key] as { apiKey?: string } | undefined;
    if (section?.apiKey) {
      masked[key] = { ...section, apiKey: section.apiKey.slice(0, 8) + '...' };
    }
  }
  return masked;
}

/** Filter messages by ticket ID. */
export function getTicketMessages(ticketId: string, messages: Message[]): Message[] {
  return messages.filter(m => m.ticketId === ticketId);
}
