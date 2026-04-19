import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

test('SCG06EA WASM building[114] identity', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('dialog', async d => { await d.accept(); });

  await page.goto(`${BASE_URL}/ra/original.html?scenario=SCG06EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });

  // Step 1 tick to populate buildings
  await page.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; });

  const state = await page.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    return {
      logicLayerLen: (s.logicLayer ?? []).length,
      logicLayer: s.logicLayer,
      structures: s.structures,
      enemyStructures: s.enemyStructures,
    };
  });

  console.log(`=== Logic layer len=${state.logicLayerLen} ===`);
  for (const entry of state.logicLayer ?? []) {
    const [idx, type, house, cx, cy] = entry;
    if (idx >= 80 && idx <= 120) {
      console.log(`  logic[${idx}] ${type} (${house}) @(${cx},${cy})`);
    }
  }

  console.log(`\n=== Structures array (${(state.structures ?? []).length}) ===`);
  for (const b of state.structures ?? []) {
    console.log(`  ${JSON.stringify(b)}`);
  }
  console.log(`\n=== Enemy structures (${(state.enemyStructures ?? []).length}) ===`);
  for (const b of state.enemyStructures ?? []) {
    console.log(`  ${JSON.stringify(b)}`);
  }

  await ctx.close();
});
