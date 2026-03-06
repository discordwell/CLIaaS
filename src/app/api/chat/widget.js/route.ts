import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/chat/widget.js
 * Returns a JavaScript snippet that customers can embed on their site.
 * Usage: <script src="https://cliaas.com/api/chat/widget.js?chatbotId=X&color=%2310b981"></script>
 *
 * Params (from script URL):
 *   chatbotId - specific chatbot to load
 *   workspaceId - workspace context
 *   channel - analytics channel (default: web)
 *   color - hex color for theme (URL-encoded, e.g. %2310b981)
 *   position - 'bottom-right' (default) or 'bottom-left'
 *   greeting - override greeting text
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  // Extract params to forward to iframe
  const chatbotId = url.searchParams.get('chatbotId') ?? '';
  const color = url.searchParams.get('color') ?? '';
  const position = url.searchParams.get('position') ?? 'bottom-right';
  const greeting = url.searchParams.get('greeting') ?? '';
  const channel = url.searchParams.get('channel') ?? 'web';

  const iframeParams = new URLSearchParams();
  if (chatbotId) iframeParams.set('chatbotId', chatbotId);
  if (color) iframeParams.set('color', color);
  if (greeting) iframeParams.set('greeting', greeting);
  if (channel) iframeParams.set('channel', channel);

  const iframeSrc = `${origin}/chat/embed${iframeParams.toString() ? '?' + iframeParams.toString() : ''}`;
  const posRight = position === 'bottom-left' ? 'left: 0' : 'right: 0';

  // Escape values for safe embedding in JS string literals
  const escJs = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

  const script = `
(function() {
  if (window.__cliaasChat) return;
  window.__cliaasChat = true;

  var iframe = document.createElement('iframe');
  iframe.src = '${escJs(iframeSrc)}';
  iframe.style.cssText = [
    'position: fixed',
    'bottom: 0',
    '${posRight}',
    'width: 400px',
    'height: 600px',
    'max-height: 100vh',
    'max-width: 100vw',
    'border: none',
    'z-index: 999999',
    'background: transparent',
    'pointer-events: none'
  ].join(';');
  iframe.id = 'cliaas-chat-widget';
  iframe.allow = 'clipboard-write';
  iframe.title = 'Chat Support';

  iframe.addEventListener('load', function() {
    iframe.style.pointerEvents = 'auto';
  });

  window.addEventListener('message', function(e) {
    if (e.origin !== '${escJs(origin)}') return;
    if (!e.data || e.data.type !== 'cliaas-chat-resize') return;

    if (e.data.minimized) {
      iframe.style.width = '80px';
      iframe.style.height = '80px';
    } else {
      iframe.style.width = '400px';
      iframe.style.height = '600px';
    }
  });

  document.body.appendChild(iframe);
})();
`.trim();

  return new NextResponse(script, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
    },
  });
}
