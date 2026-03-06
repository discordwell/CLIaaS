/**
 * Async chatbot node handlers — called by the API route after
 * evaluateBotResponse() returns a request object.
 *
 * These are separated from the pure runtime to keep it synchronous.
 */

import type {
  AiResponseRequest,
  ArticleSuggestRequest,
  WebhookRequest,
  ChatbotSessionState,
} from './types';

/**
 * Handle AI response node: call LLM with system prompt + conversation context.
 */
export async function handleAiResponse(
  req: AiResponseRequest,
  context: { customerMessage: string; variables: Record<string, string> },
): Promise<{ text: string } | null> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    // Interpolate variables into system prompt
    let systemPrompt = req.systemPrompt;
    for (const [key, val] of Object.entries(context.variables)) {
      systemPrompt = systemPrompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
    }

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: Math.min(req.maxTokens ?? 300, 2000),
      system: systemPrompt,
      messages: [{ role: 'user', content: context.customerMessage || 'Hello' }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    return { text: text || 'I apologize, I wasn\'t able to generate a response.' };
  } catch {
    return null;
  }
}

/**
 * Handle article suggestion node: search KB for relevant articles.
 */
export async function handleArticleSuggest(
  req: ArticleSuggestRequest,
): Promise<{ text: string; articles: Array<{ title: string; snippet: string }> } | null> {
  try {
    // Use the KB text-match search
    const { suggestArticles } = await import('@/lib/kb/text-match');
    const results = await suggestArticles({ query: req.query, limit: req.maxArticles });

    if (results.length === 0) return null;

    const articles = results.map((r) => ({
      title: r.title,
      snippet: r.snippet || '',
    }));

    const text = `Here are some articles that might help:\n\n${articles
      .map((a, i) => `${i + 1}. **${a.title}**\n   ${a.snippet}`)
      .join('\n\n')}`;

    return { text, articles };
  } catch {
    return null;
  }
}

/**
 * Handle webhook node: make an HTTP request with SSRF protection.
 */
export async function handleWebhook(
  req: WebhookRequest,
  variables: Record<string, string>,
): Promise<{ responseData: string; success: boolean }> {
  try {
    // SSRF protection: validate URL
    const { isObviouslyPrivateUrl } = await import('@/lib/plugins/url-safety');
    if (isObviouslyPrivateUrl(req.url)) {
      return { responseData: '', success: false };
    }

    // Interpolate variables into body template (JSON-escape values to prevent injection)
    let body: string | undefined;
    if (req.bodyTemplate) {
      body = req.bodyTemplate;
      for (const [key, val] of Object.entries(variables)) {
        const safeVal = JSON.stringify(val).slice(1, -1); // strip outer quotes, keep escape sequences
        body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), safeVal);
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...req.headers,
    };

    const response = await fetch(req.url, {
      method: req.method,
      headers,
      body: req.method !== 'GET' ? body : undefined,
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });

    const responseData = await response.text();
    return { responseData, success: response.ok };
  } catch {
    return { responseData: '', success: false };
  }
}

/**
 * Process async node results and update session state.
 */
import type { BotResponse } from './types';

export async function processAsyncNode(
  result: BotResponse,
  customerMessage: string,
): Promise<{ text?: string; newState: ChatbotSessionState }> {
  const state = result.newState;

  if (result.aiRequest) {
    const aiResult = await handleAiResponse(result.aiRequest, {
      customerMessage,
      variables: state.variables,
    });

    if (aiResult) {
      return { text: aiResult.text, newState: state };
    }

    // Fallback if AI fails
    const fallbackId = result.aiRequest.fallbackNodeId;
    if (fallbackId) {
      state.currentNodeId = fallbackId;
    }
    return { text: 'I\'m having trouble generating a response. Let me connect you with an agent.', newState: state };
  }

  if (result.articleRequest) {
    const articleResult = await handleArticleSuggest(result.articleRequest);
    if (articleResult) {
      return { text: articleResult.text, newState: state };
    }

    // No results: go to noResultsNodeId if set
    const noResultsId = result.articleRequest.noResultsNodeId;
    if (noResultsId) {
      state.currentNodeId = noResultsId;
    }
    return { text: 'I couldn\'t find any relevant articles. Let me connect you with an agent.', newState: state };
  }

  if (result.webhookRequest) {
    const webhookResult = await handleWebhook(result.webhookRequest, state.variables);

    if (webhookResult.success && result.webhookRequest.responseVariable) {
      // Truncate response to prevent session bloat
      state.variables[result.webhookRequest.responseVariable] = webhookResult.responseData.slice(0, 10240);
    }

    if (!webhookResult.success) {
      const failureId = result.webhookRequest.failureNodeId;
      if (failureId) {
        state.currentNodeId = failureId;
      }
    }

    return { newState: state };
  }

  return { newState: state };
}
