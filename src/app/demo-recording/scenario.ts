export type ScenarioStep =
  | { type: 'user-input'; text: string }
  | { type: 'response'; lines: { text: string; className?: string }[] }
  | { type: 'pause'; ms: number };

/**
 * Demo scenario: install → setup → sync → triage → investigation
 * Targets ~30s total playback at 1× speed.
 */
export const scenario: ScenarioStep[] = [
  // ── Turn 1: Install ──
  { type: 'user-input', text: 'hi Claude, install cliaas' },
  { type: 'pause', ms: 400 },
  {
    type: 'response',
    lines: [
      { text: '' },
      { text: '  ● Explore(Find CLIaaS install method) Haiku 4.5', className: 'text-zinc-500' },
      { text: '  ● Done (14 tool uses · 43.6k tokens · 33s)', className: 'text-green-400' },
      { text: '' },
      { text: '  Bash(npm install -g cliaas)', className: 'text-emerald-400' },
      { text: '    added 1 package in 3s', className: 'text-zinc-500' },
      { text: '  Bash(cliaas init)', className: 'text-emerald-400' },
      { text: '    Wrote .mcp.json', className: 'text-zinc-500' },
      { text: '    Created ~/.claude/CLAUDE.md', className: 'text-zinc-500' },
      { text: '    Demo data written to ~/.cliaas/data/', className: 'text-zinc-500' },
      { text: '' },
      { text: '  CLIaaS is installed and the MCP server is configured.' },
      { text: '  Claude Code will auto-connect to all 60 MCP tools' },
      { text: '  when working in this project.' },
      { text: '' },
    ],
  },

  // ── Turn 2: Setup ──
  { type: 'user-input', text: 'okay now set up byoc locally' },
  { type: 'pause', ms: 400 },
  {
    type: 'response',
    lines: [
      { text: '' },
      { text: '  ● Read(WIZARD/claude.md)', className: 'text-zinc-500' },
      { text: '  ● Bash(cliaas setup)', className: 'text-zinc-500' },
      { text: '    ✓ PostgreSQL connected (localhost:5432)', className: 'text-green-400' },
      { text: '    ✓ Created database \'cliaas\'', className: 'text-green-400' },
      { text: '    ✓ Ran 42 migrations', className: 'text-green-400' },
      { text: '    ✓ LLM provider: openai (OPENAI_API_KEY set)', className: 'text-green-400' },
      { text: '    +2 lines (ctrl+e to expand)', className: 'text-zinc-500' },
      { text: '' },
      { text: '  Your BYOC instance is ready. I followed the setup' },
      { text: '  instructions in WIZARD/claude.md — database, migrations,' },
      { text: '  and LLM provider are all configured.' },
      { text: '' },
    ],
  },

  // ── Turn 3: Sync ──
  { type: 'user-input', text: 'cool my Zendesk API key is •••••••• download all my tickets' },
  { type: 'pause', ms: 400 },
  {
    type: 'response',
    lines: [
      { text: '' },
      { text: '  ● Bash(cliaas sync run --connector zendesk --full)', className: 'text-zinc-500' },
      { text: '    ✓ 2,847 tickets synced (4.2s)', className: 'text-green-400' },
      { text: '    ✓ 11,923 messages imported', className: 'text-green-400' },
      { text: '    ✓ Next sync: incremental (cursor saved)', className: 'text-green-400' },
      { text: '' },
      { text: '  All 2,847 tickets and 11,923 messages are synced. Future' },
      { text: '  syncs will be incremental — cursor is saved.' },
      { text: '' },
    ],
  },

  // ── Turn 4: Triage ──
  { type: 'user-input', text: 'my phone is blowing up, what broke overnight?' },
  { type: 'pause', ms: 500 },
  {
    type: 'response',
    lines: [
      { text: '' },
      { text: '  ● triage_batch(status: open, limit: 20)', className: 'text-zinc-500' },
      { text: '  ● queue_stats()', className: 'text-zinc-500' },
      { text: '  ● Done (6 tool uses · 28.1k tokens · 12s)', className: 'text-green-400' },
      { text: '' },
      { text: '  3 urgent tickets opened since 3 AM:', className: 'text-red-400' },
      { text: '' },
      { text: '  #4012  502 errors on checkout — 47 customers affected', className: 'text-red-400' },
      { text: '  #4015  SSL cert expired — API returning insecure warnings', className: 'text-red-400' },
      { text: '  #4018  Database connection pool exhausted', className: 'text-yellow-400' },
      { text: '' },
      { text: '  All three spiked at 3:12 AM. Let me investigate.' },
      { text: '' },
    ],
  },

  // ── Turn 5: Investigation ──
  { type: 'pause', ms: 600 },
  {
    type: 'response',
    lines: [
      { text: '  ● tickets_show(4012)', className: 'text-zinc-500' },
      { text: '  ● tickets_show(4015)', className: 'text-zinc-500' },
      { text: '  ● tickets_show(4018)', className: 'text-zinc-500' },
      { text: '  ● sentiment_analyze(status: open)', className: 'text-zinc-500' },
      { text: '  ● Done (9 tool uses · 51.3k tokens · 18s)', className: 'text-green-400' },
      { text: '' },
      { text: '  Root cause: SSL cert on api.acme.com expired at 3:11 AM.', className: 'text-emerald-400' },
      { text: '  This caused cascading failures:', className: 'text-emerald-400' },
      { text: '' },
      { text: '    1. Payment gateway rejected insecure callbacks → 502s' },
      { text: '    2. Retry storms exhausted the DB connection pool' },
      { text: '    3. 47 customers hit checkout errors in a 2-hour window' },
      { text: '' },
      { text: '  Renewing the cert should fix all three. I\'ve drafted' },
      { text: '  replies for the 8 most frustrated customers. Want me' },
      { text: '  to send them?' },
    ],
  },
];

/**
 * Estimate total animation duration in milliseconds.
 * User input: ~50ms/char. Response lines: ~250ms each. Pauses: explicit.
 */
export function estimateDuration(steps: ScenarioStep[], speed = 1): number {
  let total = 0;
  for (const step of steps) {
    switch (step.type) {
      case 'user-input':
        total += (step.text.length * 50 + 300) / speed; // typing + brief pause after
        break;
      case 'response':
        total += (step.lines.length * 250) / speed;
        break;
      case 'pause':
        total += step.ms / speed;
        break;
    }
  }
  return total;
}
