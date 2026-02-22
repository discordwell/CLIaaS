import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadTickets, loadMessages, loadKBArticles } from '@/lib/data';
import { generateInsights } from '@/lib/ai/proactive';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ai/insights - Get proactive intelligence insights
 *
 * Query params:
 *   useLLM: 'true' | 'false' (default 'true')
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const useLLM = searchParams.get('useLLM') !== 'false';

    // Check for API keys when LLM is requested
    if (useLLM) {
      const hasKey = !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY;
      if (!hasKey) {
        // Fall back to heuristic mode instead of failing
        const tickets = await loadTickets();
        const messages = await loadMessages();
        const kbArticles = await loadKBArticles();
        const insights = await generateInsights(tickets, messages, kbArticles, false);
        return NextResponse.json({
          insights,
          mode: 'heuristic',
          note: 'No LLM API key found. Using heuristic analysis. Set ANTHROPIC_API_KEY or OPENAI_API_KEY for enhanced insights.',
        });
      }
    }

    const tickets = await loadTickets();
    const messages = await loadMessages();
    const kbArticles = await loadKBArticles();

    const insights = await generateInsights(tickets, messages, kbArticles, useLLM);

    return NextResponse.json({
      insights,
      mode: useLLM ? 'llm-enhanced' : 'heuristic',
      ticketCount: tickets.length,
      messageCount: messages.length,
      kbArticleCount: kbArticles.length,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to generate insights',
      },
      { status: 500 },
    );
  }
}
