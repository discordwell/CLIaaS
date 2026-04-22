/**
 * Dump WASM agent_get_state logicLayer at tick 1 for selected scenarios.
 * Includes buildings/vessels now that agent_harness.cpp was extended (task ad83df56).
 * Usage:
 *   BASE_URL=http://localhost:3002 SCENARIOS=SCG11EA,SCG07EA,SCG03EA \
 *     npx playwright test scripts/test-wasm-logic-dump.ts --reporter=list
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3002';
const ALL = ['SCG01EA','SCG03EA','SCG04EA','SCG06EA','SCG07EA','SCG11EA','SCG13EA'];
const scenarios = process.env.SCENARIOS?.split(',') ?? ALL;

for (const scenario of scenarios) {
  test(`${scenario} WASM Logic layer dump`, async ({ browser }) => {
    test.setTimeout(5 * 60 * 1000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('dialog', async d => { await d.accept(); });

    await page.goto(`${BASE_URL}/ra/original.html?scenario=${scenario}.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => {
      try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
    }, { timeout: 180_000, polling: 2000 });

    // Step 1 tick so logicLayer is populated
    await page.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; });
    const s = await page.evaluate(() => {
      const M = (window as any).Module;
      return JSON.parse(M.ccall('agent_get_state','string',[],[]));
    });

    const layer = s.logicLayer ?? [];
    console.log(`\n=== ${scenario} Logic layer (tick=${s.tick}, len=${layer.length}) ===`);
    for (const entry of layer) {
      if (Array.isArray(entry) && entry.length >= 6) {
        const [idx, type, house, cx, cy, rtti] = entry as [number, string, string, number, number, string];
        console.log(`  logic[${idx}] ${rtti} ${type} (${house}) @(${cx},${cy})`);
      } else if (Array.isArray(entry) && entry.length === 5) {
        const [idx, type, house, cx, cy] = entry as [number, string, string, number, number];
        console.log(`  logic[${idx}] ? ${type} (${house}) @(${cx},${cy})`);
      }
    }

    await ctx.close();
  });
}
