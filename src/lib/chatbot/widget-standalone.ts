/**
 * Shadow DOM standalone chat widget.
 * This is served as a JS bundle from /api/chat/widget-standalone.js
 * and creates a self-contained chat widget on the customer's page.
 */

export function generateStandaloneWidgetScript(origin: string): string {
  const escJs = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  return `
(function() {
  if (window.__cliaasChat) return;
  window.__cliaasChat = true;

  var config = {
    apiBase: '${escJs(origin)}/api/chat',
    color: '#09090b',
    position: 'bottom-right',
    chatbotId: '',
    channel: 'web'
  };

  // Parse config from script tag data attributes
  var scripts = document.querySelectorAll('script[data-cliaas]');
  var script = scripts[scripts.length - 1];
  if (script) {
    config.color = script.getAttribute('data-color') || config.color;
    config.position = script.getAttribute('data-position') || config.position;
    config.chatbotId = script.getAttribute('data-chatbot-id') || config.chatbotId;
    config.channel = script.getAttribute('data-channel') || config.channel;
  }

  // Create host element
  var host = document.createElement('div');
  host.id = 'cliaas-chat-standalone';
  document.body.appendChild(host);

  var shadow = host.attachShadow({ mode: 'open' });

  // Styles
  var style = document.createElement('style');
  style.textContent = \`
    :host { all: initial; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .cliaas-btn { position: fixed; bottom: 16px; \${config.position === 'bottom-left' ? 'left' : 'right'}: 16px; width: 56px; height: 56px; background: \${config.color}; color: #fff; border: 2px solid \${config.color}; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 999999; }
    .cliaas-btn svg { width: 24px; height: 24px; }
    .cliaas-container { position: fixed; bottom: 16px; \${config.position === 'bottom-left' ? 'left' : 'right'}: 16px; width: 360px; max-width: calc(100vw - 32px); font-size: 14px; line-height: 1.4; color: #09090b; background: #fff; border: 2px solid #09090b; box-shadow: 0 8px 24px rgba(0,0,0,0.12); display: flex; flex-direction: column; z-index: 999999; }
    .cliaas-chat { height: 520px; max-height: calc(100vh - 32px); }
    .cliaas-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: \${config.color}; color: #fff; border-bottom: 2px solid #09090b; flex-shrink: 0; }
    .cliaas-header-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; }
    .cliaas-close { background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; font-size: 16px; }
    .cliaas-messages { flex: 1; overflow-y: auto; padding: 12px 16px; }
    .cliaas-msg { margin-bottom: 12px; display: flex; flex-direction: column; }
    .cliaas-msg-customer { align-items: flex-end; }
    .cliaas-msg-bot { align-items: flex-start; }
    .cliaas-msg-label { margin-bottom: 2px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #a1a1aa; }
    .cliaas-msg-bubble { max-width: 85%; border: 2px solid; padding: 8px 12px; font-size: 13px; }
    .cliaas-msg-customer .cliaas-msg-bubble { border-color: #09090b; background: #09090b; color: #fff; }
    .cliaas-msg-bot .cliaas-msg-bubble { border-color: #a5b4fc; background: #eef2ff; color: #09090b; }
    .cliaas-input-row { display: flex; border-top: 2px solid #09090b; flex-shrink: 0; }
    .cliaas-input { flex: 1; padding: 12px 16px; border: none; outline: none; font-size: 13px; font-family: inherit; }
    .cliaas-send { background: #09090b; color: #fff; padding: 12px 16px; border: none; border-left: 2px solid #09090b; font-size: 11px; font-weight: 700; text-transform: uppercase; cursor: pointer; font-family: inherit; }
    .cliaas-send:disabled { background: #a1a1aa; cursor: not-allowed; }
    .cliaas-buttons { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; max-width: 85%; }
    .cliaas-btn-option { border: 2px solid \${config.color}; background: #fff; color: \${config.color}; padding: 4px 12px; font-size: 11px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .cliaas-form { padding: 24px; display: flex; flex-direction: column; gap: 16px; }
    .cliaas-form-label { display: block; margin-bottom: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #71717a; letter-spacing: 0.05em; }
    .cliaas-form-input { width: 100%; padding: 8px 12px; border: 2px solid #09090b; font-size: 13px; outline: none; font-family: inherit; }
    .cliaas-form-submit { width: 100%; padding: 10px 16px; background: #09090b; color: #fff; border: 2px solid #09090b; font-size: 11px; font-weight: 700; text-transform: uppercase; cursor: pointer; font-family: inherit; }
    .cliaas-form-error { font-size: 11px; color: #dc2626; }
  \`;
  shadow.appendChild(style);

  // State
  var state = { view: 'button', sessionId: null, messages: [], input: '', name: '', email: '', status: 'waiting', sending: false };

  var container = document.createElement('div');
  shadow.appendChild(container);

  function render() {
    if (state.view === 'button') {
      container.innerHTML = '<button class="cliaas-btn" title="Open chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>';
      container.querySelector('.cliaas-btn').onclick = function() { state.view = state.sessionId ? 'chat' : 'prechat'; render(); };
      return;
    }

    if (state.view === 'prechat') {
      container.innerHTML = '<div class="cliaas-container"><div class="cliaas-header"><span class="cliaas-header-label">Live Chat</span><button class="cliaas-close">&times;</button></div><form class="cliaas-form"><p style="font-size:13px;color:#52525b">Start a conversation with our team.</p><div><label class="cliaas-form-label">Name</label><input class="cliaas-form-input" placeholder="Your name" id="cliaas-name"></div><div><label class="cliaas-form-label">Email</label><input class="cliaas-form-input" type="email" placeholder="you@example.com" id="cliaas-email"></div><div class="cliaas-form-error" id="cliaas-error"></div><button type="submit" class="cliaas-form-submit">Start Chat</button></form></div>';
      container.querySelector('.cliaas-close').onclick = function() { state.view = 'button'; render(); };
      container.querySelector('form').onsubmit = function(e) { e.preventDefault(); startChat(); };
      return;
    }

    // Chat view
    var msgsHtml = state.messages.map(function(m) {
      var cls = m.role === 'customer' ? 'cliaas-msg cliaas-msg-customer' : 'cliaas-msg cliaas-msg-bot';
      var label = m.role === 'customer' ? 'You' : 'Bot';
      var btns = '';
      if (m.buttons) {
        btns = '<div class="cliaas-buttons">' + m.buttons.map(function(b) { return '<button class="cliaas-btn-option" data-label="' + b.label.replace(/"/g,'&quot;') + '">' + b.label + '</button>'; }).join('') + '</div>';
      }
      return '<div class="' + cls + '"><div class="cliaas-msg-label">' + label + '</div><div class="cliaas-msg-bubble">' + m.body + '</div>' + btns + '</div>';
    }).join('');

    container.innerHTML = '<div class="cliaas-container cliaas-chat"><div class="cliaas-header"><span class="cliaas-header-label">Live Chat</span><button class="cliaas-close">&minus;</button></div><div class="cliaas-messages">' + msgsHtml + '</div><div class="cliaas-input-row"><input class="cliaas-input" placeholder="Type a message..." id="cliaas-input"><button class="cliaas-send" id="cliaas-send">Send</button></div></div>';

    container.querySelector('.cliaas-close').onclick = function() { state.view = 'button'; render(); };
    container.querySelectorAll('.cliaas-btn-option').forEach(function(btn) {
      btn.onclick = function() { sendMessage(btn.getAttribute('data-label')); };
    });

    var inputEl = container.querySelector('#cliaas-input');
    var sendBtn = container.querySelector('#cliaas-send');
    sendBtn.onclick = function() {
      var val = inputEl.value.trim();
      if (val) { inputEl.value = ''; sendMessage(val); }
    };
    inputEl.onkeydown = function(e) {
      if (e.key === 'Enter') { sendBtn.click(); }
    };

    // Scroll to bottom
    var msgsEl = container.querySelector('.cliaas-messages');
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function startChat() {
    var nameEl = shadow.getElementById('cliaas-name');
    var emailEl = shadow.getElementById('cliaas-email');
    var errorEl = shadow.getElementById('cliaas-error');
    var n = nameEl ? nameEl.value.trim() : '';
    var em = emailEl ? emailEl.value.trim() : '';
    if (!n || !em) { if (errorEl) errorEl.textContent = 'Name and email required.'; return; }

    var body = { action: 'create', customerName: n, customerEmail: em };
    if (config.chatbotId) body.chatbotId = config.chatbotId;
    if (config.channel) body.channel = config.channel;

    fetch(config.apiBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        state.sessionId = data.sessionId;
        state.messages = (data.messages || []).map(function(m) { return { role: m.role, body: m.body, buttons: m.metadata && m.metadata.buttons }; });
        state.view = 'chat';
        render();
        startPolling();
      })
      .catch(function() { if (errorEl) errorEl.textContent = 'Connection error.'; });
  }

  function sendMessage(text) {
    if (!state.sessionId || state.sending) return;
    state.sending = true;
    state.messages.push({ role: 'customer', body: text });
    render();

    fetch(config.apiBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'message', sessionId: state.sessionId, role: 'customer', body: text }) })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.botMessage) { state.messages.push({ role: 'bot', body: data.botMessage.body, buttons: data.botMessage.metadata && data.botMessage.metadata.buttons }); }
        state.sending = false;
        render();
      })
      .catch(function() { state.sending = false; });
  }

  function startPolling() {
    setInterval(function() {
      if (!state.sessionId) return;
      fetch(config.apiBase + '?sessionId=' + state.sessionId)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.messages) {
            var ids = new Set(state.messages.map(function(m) { return m.id; }));
            data.messages.forEach(function(m) {
              if (!ids.has(m.id) && m.role !== 'customer') {
                state.messages.push({ role: m.role, body: m.body, id: m.id, buttons: m.metadata && m.metadata.buttons });
              }
            });
            render();
          }
        })
        .catch(function() {});
    }, 3000);
  }

  render();
})();
`;
}
