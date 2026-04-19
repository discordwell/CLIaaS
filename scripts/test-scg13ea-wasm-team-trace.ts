/**
 * Dump WASM team state for ticks 85-105 of SCG13EA, focusing on USSR teams.
 * Compare against TS trace to find where team activation timing diverges.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA WASM team trace 85-105', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const wasmPage = await wasmCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG13EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' });
  await wasmPage.waitForFunction(() => {
    try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });

  // Step to tick 85 in bulk
  await wasmPage.evaluate(async () => {
    const r = (window as any).__agentStep(85);
    if (r?.then) await r;
  });

  for (let t = 86; t <= 105; t++) {
    const data = await wasmPage.evaluate(async () => {
      const r = (window as any).__agentStep(1);
      const res = r?.then ? await r : r;
      const s = res?.state ?? res;
      return {
        tick: s.tick,
        teams: (s.teams ?? []).map((t: { i: number; cls: string; house: string; total: number; desired: number; fs: boolean; us: boolean; mv: boolean; hb: boolean; rf: boolean; members: unknown[] }) => ({
          i: t.i, cls: t.cls, house: t.house, total: t.total, desired: t.desired,
          fs: t.fs, us: t.us, mv: t.mv, hb: t.hb, rf: t.rf,
          members: t.members,
        })),
      };
    });
    console.log(`tick ${data.tick}: ${JSON.stringify(data.teams)}`);
  }

  await wasmCtx.close();
});
