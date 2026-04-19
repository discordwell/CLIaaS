import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

test('SCG06EA last building identity', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto(`${BASE_URL}?anttest=agent&scenario=SCG06EA&difficulty=normal`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });

  const info = await page.evaluate(() => {
    const game = (window as any).__agentGame;
    const structs = game.structures ?? [];
    return structs.map((s: { type: string; house: string; cx: number; cy: number; alive: boolean; isCloaked?: boolean }, i: number) => ({
      i, type: s.type, house: s.house, cx: s.cx, cy: s.cy, alive: s.alive, cloaked: s.isCloaked,
    }));
  });

  console.log(`=== TS SCG06EA structures (${info.length}) ===`);
  for (const s of info) console.log(`  [${s.i}] ${s.type} (${s.house}) @(${s.cx},${s.cy}) cloaked=${s.cloaked}`);

  // Also dump WASM buildings from agent_state
  const wasmCtx = await browser.newContext();
  const wasmPage = await wasmCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });
  await wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG06EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' });
  await wasmPage.waitForFunction(() => {
    try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });
  const wasmState = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    return (s.buildings ?? []).map((b: { t: string; house: string; cx: number; cy: number; cloaked?: boolean; id?: number }, i: number) => ({
      i, t: b.t, house: b.house, cx: b.cx, cy: b.cy, cloaked: b.cloaked, id: b.id,
    }));
  });
  console.log(`\n=== WASM SCG06EA buildings (${wasmState.length}) ===`);
  for (const b of wasmState) console.log(`  [${b.i}] ${b.t} (${b.house}) @(${b.cx},${b.cy}) cloaked=${b.cloaked}`);

  await wasmCtx.close();
  await ctx.close();
});
