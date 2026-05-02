/**
 * Probe Greek E1 at (12,54) initial mission timer at tick 1.
 * WASM has mt=13 at t101 (jitter=0); TS has mt=15 — 2-tick offset suggests
 * different jitter at scenario init. Find the initial mt value at tick 1.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA Greek E1 (12,54) init timer probe', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG13EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tsPage.goto(`${BASE_URL}?anttest=agent&scenario=SCG13EA&difficulty=normal`, { waitUntil: 'load' }),
  ]);

  await Promise.all([
    wasmPage.waitForFunction(() => {
      try {
        const M = (window as any).Module;
        return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0;
      } catch { return false; }
    }, { timeout: 180_000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);

  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state','string',[],[])).rngState);
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  // Bulk step to tick 95
  for (let t = 0; t < 95; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  // Per-tick probe ticks 95-103
  for (let i = 0; i < 9; i++) {
    const t = 95 + i;
    if (i > 0) {
      await Promise.all([
        wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
        tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
      ]);
    }

    const wasmGreekE1 = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      const all = [...(s.units ?? []), ...(s.enemies ?? [])];
      return all
        .filter((u: { t: string; house: string; cx: number; cy: number }) =>
          u.t === 'E1' && u.house === 'Greece' && u.cx === 12 && u.cy === 54)
        .map((u: { id: number; t: string; house: string; cx: number; cy: number; m: number; mt: number }) => ({
          id: u.id, t: u.t, h: u.house, c: `(${u.cx},${u.cy})`, m: u.m, mt: u.mt
        }));
    });

    const tsGreekE1 = await tsPage.evaluate(() => {
      const game = (window as any).__agentGame;
      if (!game) return null;
      return game.entities
        .filter((e: { alive: boolean; inLimbo: boolean; type: string; house: string; cell: { cx: number; cy: number } }) =>
          e.alive && !e.inLimbo && e.type === 'E1' && e.house === 'Greece' && e.cell.cx === 12 && e.cell.cy === 54)
        .map((e: { id: number; type: string; house: string; cell: { cx: number; cy: number }; mission: string; missionTimer: number }) => ({
          id: e.id, t: e.type, h: e.house, c: `(${e.cell.cx},${e.cell.cy})`, m: e.mission, mt: e.missionTimer
        }));
    });

    console.log(`tick ${t}: WASM=${JSON.stringify(wasmGreekE1)} TS=${JSON.stringify(tsGreekE1)}`);
  }

  await wasmCtx.close();
  await tsCtx.close();
});
