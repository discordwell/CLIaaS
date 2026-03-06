import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── 10.1: Views store scoping ─────────────────────────────────

describe('10.1: View store personal scoping', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listViews filters personal views by userId', async () => {
    const { listViews, createView } = await import('@/lib/views/store');

    createView({
      name: 'Agent A View',
      viewType: 'personal',
      userId: 'agent-a',
      query: {
        conditions: [{ field: 'assignee', operator: 'is', value: 'agent-a' }],
        combineMode: 'and',
      },
    });

    createView({
      name: 'Agent B View',
      viewType: 'personal',
      userId: 'agent-b',
      query: {
        conditions: [{ field: 'assignee', operator: 'is', value: 'agent-b' }],
        combineMode: 'and',
      },
    });

    createView({
      name: 'Shared VIP View',
      viewType: 'shared',
      query: {
        conditions: [{ field: 'tag', operator: 'is', value: 'vip' }],
        combineMode: 'and',
      },
    });

    // Agent A should see: system views + shared views + their own personal view
    const agentAViews = listViews('agent-a');
    const personalForA = agentAViews.filter((v) => v.viewType === 'personal');
    expect(personalForA.length).toBe(1);
    expect(personalForA[0].name).toBe('Agent A View');

    // Agent B should see their own personal view, not Agent A's
    const agentBViews = listViews('agent-b');
    const personalForB = agentBViews.filter((v) => v.viewType === 'personal');
    expect(personalForB.length).toBe(1);
    expect(personalForB[0].name).toBe('Agent B View');

    // Both should see the shared view
    expect(agentAViews.some((v) => v.name === 'Shared VIP View')).toBe(true);
    expect(agentBViews.some((v) => v.name === 'Shared VIP View')).toBe(true);

    // No userId -> should not see personal views
    const anonViews = listViews();
    const personalForAnon = anonViews.filter((v) => v.viewType === 'personal');
    expect(personalForAnon.length).toBe(0);
  });

  it('system views cannot be deleted or updated', async () => {
    const { listViews, deleteView, updateView } = await import('@/lib/views/store');
    const systemView = listViews().find((v) => v.viewType === 'system');
    expect(systemView).toBeTruthy();

    const deleteResult = deleteView(systemView!.id);
    expect(deleteResult).toBe(false);

    const updateResult = updateView(systemView!.id, { name: 'Hacked' });
    expect(updateResult).toBeNull();
  });
});

// ── 10.1: ViewBuilder component export ───────────────────────

describe('10.1: ViewBuilder component', () => {
  it('exports a default function', async () => {
    const mod = await import('@/components/ViewBuilder');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});

// ── 10.1: Views settings page module ────────────────────────

describe('10.1: Views settings page', () => {
  it('page module exports default component', async () => {
    const mod = await import('@/app/settings/views/page');
    expect(mod.default).toBeDefined();
  });

  it('_content module exports default component', async () => {
    const mod = await import('@/app/settings/views/_content');
    expect(mod.default).toBeDefined();
  });
});

// ── 10.2: Holiday calendar UI ────────────────────────────────

describe('10.2: Business hours content module', () => {
  it('exports default component', async () => {
    const mod = await import('@/app/business-hours/_content');
    expect(mod.default).toBeDefined();
  });
});

// ── 10.3: ChartRenderer smoke ────────────────────────────────

describe('10.3: ChartRenderer exists and exports', () => {
  it('ChartRenderer module exports default function', async () => {
    const mod = await import('@/components/charts/ChartRenderer');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('BarChart sub-component exports', async () => {
    const mod = await import('@/components/charts/BarChart');
    expect(mod.default).toBeDefined();
  });

  it('LineChart sub-component exports', async () => {
    const mod = await import('@/components/charts/LineChart');
    expect(mod.default).toBeDefined();
  });

  it('PieChart sub-component exports', async () => {
    const mod = await import('@/components/charts/PieChart');
    expect(mod.default).toBeDefined();
  });

  it('NumberCard sub-component exports', async () => {
    const mod = await import('@/components/charts/NumberCard');
    expect(mod.default).toBeDefined();
  });
});

// ── 10.4: KB MCP tools ──────────────────────────────────────

describe('10.4: KB MCP tools registry', () => {
  it('registerKBTools is a function', async () => {
    const mod = await import('../../cli/mcp/tools/kb');
    expect(typeof mod.registerKBTools).toBe('function');
  });

  it('kb.ts defines kb_translate tool', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('cli/mcp/tools/kb.ts', 'utf8');
    expect(src).toContain("'kb_translate'");
    expect(src).toContain("'kb_feedback_summary'");
    expect(src).toContain("'kb_content_gaps'");
  });

  it('server.ts imports registerKBTools', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('cli/mcp/server.ts', 'utf8');
    expect(src).toContain('registerKBTools');
  });
});

// ── 10.5: Portal KB branding ────────────────────────────────

describe('10.5: Portal KB branding', () => {
  it('portal KB layout exports default component', async () => {
    const mod = await import('@/app/portal/kb/layout');
    expect(mod.default).toBeDefined();
  });

  it('BrandThemeProvider exports useBrandTheme hook', async () => {
    const mod = await import('@/components/BrandThemeProvider');
    expect(mod.default).toBeDefined();
    expect(mod.useBrandTheme).toBeDefined();
    expect(typeof mod.useBrandTheme).toBe('function');
  });

  it('BrandTheme type has portal-relevant fields', async () => {
    // Check via source inspection that the BrandTheme interface includes
    // helpCenterTitle, customCss, headerHtml, footerHtml
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/components/BrandThemeProvider.tsx', 'utf8');
    expect(src).toContain('helpCenterTitle');
    expect(src).toContain('customCss');
    expect(src).toContain('headerHtml');
    expect(src).toContain('footerHtml');
    expect(src).toContain('logoUrl');
  });
});
