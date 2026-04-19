/**
 * Check WASM entity at cell (42,62) at tick 42 end.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('WASM entity at (42,62)', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const wasmPage = await wasmCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG13EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' });
  await wasmPage.waitForFunction(() => {
    try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });

  for (let t = 0; t < 42; t++) {
    await wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; });
  }

  const state = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    const all = [...(s.units ?? []), ...(s.enemies ?? [])];
    return all
      .filter((u: { cx: number; cy: number }) => u.cx >= 40 && u.cx <= 45 && u.cy >= 60 && u.cy <= 64)
      .map((u: { id: number; t: string; house: string; cx: number; cy: number; m: number; mt: number; arm: number }) => u);
  });

  console.log(`=== WASM entities near cell (42,62) ===`);
  for (const e of state) console.log(`  id=${e.id} t=${e.t} house=${e.house} (${e.cx},${e.cy}) m=${e.m} mt=${e.mt} arm=${e.arm}`);

  await wasmCtx.close();
});
