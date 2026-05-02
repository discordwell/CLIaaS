/**
 * Probe ALL WASM teams + units at tick 113-114 to identify why TS over-fires.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA t114 teams probe', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const wasmPage = await wasmCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG13EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' });
  await wasmPage.waitForFunction(() => {
    try {
      const M = (window as any).Module;
      return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0;
    } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });

  for (let t = 0; t < 113; t++) {
    await wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; });
  }

  for (let t = 113; t <= 115; t++) {
    const teams = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      return (s.teams ?? []).map((tm: { i: number; cls: string; cur: number; tgtX: number; tgtY: number; mtgtX: number; mtgtY: number; missions: unknown[] }) =>
        ({ i: tm.i, cls: tm.cls, cur: tm.cur, tgt: `(${tm.tgtX},${tm.tgtY})`, mtgt: `(${tm.mtgtX},${tm.mtgtY})`, missions: tm.missions }));
    });
    console.log(`tick ${t} teams:`);
    for (const tm of teams) console.log(`  ${JSON.stringify(tm)}`);

    if (t < 115) {
      await wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; });
    }
  }

  await wasmCtx.close();
});
