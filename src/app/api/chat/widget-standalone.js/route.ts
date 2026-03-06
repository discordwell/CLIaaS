import { NextResponse } from 'next/server';
import { generateStandaloneWidgetScript } from '@/lib/chatbot/widget-standalone';

export const dynamic = 'force-dynamic';

/**
 * GET /api/chat/widget-standalone.js
 * Serves the shadow DOM standalone chat widget bundle.
 * Usage: <script data-cliaas data-chatbot-id="xxx" data-color="#10b981" src="https://cliaas.com/api/chat/widget-standalone.js"></script>
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const script = generateStandaloneWidgetScript(origin);

  return new NextResponse(script, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
    },
  });
}
