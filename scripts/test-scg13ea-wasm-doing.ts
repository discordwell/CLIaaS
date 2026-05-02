/**
 * Probe WASM's Doing state for USSR E1 (61,67) over ticks 91-105.
 * Find when Doing transitions and what values it takes.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA WASM doing trace', async ({ browser }) => {
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

  let prev = '';
  for (let t = 0; t < 110; t++) {
    if (t > 0) {
      await wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; });
    }
    const state = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      const all = [...(s.units ?? []), ...(s.enemies ?? [])];
      const u = all.find((x: { id: number }) => x.id === 852056);
      if (!u) return 'gone';
      return JSON.stringify({ m: u.m, mt: u.mt, mq: u.mq, drv: u.drv, doing: u.doing, idle: u.idle, firing: u.firing });
    });
    if (state !== prev) {
      console.log(`tick ${t}: ${state}`);
      prev = state;
    }
  }

  await wasmCtx.close();
});
