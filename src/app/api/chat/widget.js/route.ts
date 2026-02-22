import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/chat/widget.js
 * Returns a JavaScript snippet that customers can embed on their site.
 * Usage: <script src="https://cliaas.com/api/chat/widget.js"></script>
 *
 * The script creates an iframe pointing to the standalone chat embed page.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  const script = `
(function() {
  if (window.__cliaasChat) return;
  window.__cliaasChat = true;

  var iframe = document.createElement('iframe');
  iframe.src = '${origin}/chat/embed';
  iframe.style.cssText = [
    'position: fixed',
    'bottom: 0',
    'right: 0',
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

  // Allow pointer events only within the widget area
  iframe.addEventListener('load', function() {
    iframe.style.pointerEvents = 'auto';
  });

  // Listen for resize messages from the iframe
  window.addEventListener('message', function(e) {
    if (e.origin !== '${origin}') return;
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
    },
  });
}
