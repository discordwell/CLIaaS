/**
 * Probe BOTH Greek E1 (12,54) and USSR STICKY (27,46) at ticks 95-103.
 * Find which unit's mt timing differs between TS and WASM.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA both units mt probe', async ({ browser }) => {
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

  // Bulk to tick 95
  for (let t = 0; t < 95; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  for (let i = 0; i < 9; i++) {
    if (i > 0) {
      await Promise.all([
        wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
        tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
      ]);
    }
    const t = 95 + i;

    const wasm = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      const all = [...(s.units ?? []), ...(s.enemies ?? [])];
      const e1 = all.find((u: { t: string; house: string; cx: number; cy: number }) =>
        u.t === 'E1' && u.house === 'Greece' && u.cx === 12 && u.cy === 54);
      const sticky = all.find((u: { house: string; cx: number; cy: number; m: number }) =>
        u.house === 'USSR' && u.cx === 27 && u.cy === 46 && u.m === 6);
      return { e1: e1 ? { id: e1.id, m: e1.m, mt: e1.mt } : null,
               sticky: sticky ? { id: sticky.id, m: sticky.m, mt: sticky.mt, t: sticky.t } : null };
    });

    const ts = await tsPage.evaluate(() => {
      const game = (window as any).__agentGame;
      if (!game) return null;
      const e1 = game.entities.find((e: { alive: boolean; type: string; house: string; cell: { cx: number; cy: number } }) =>
        e.alive && e.type === 'E1' && e.house === 'Greece' && e.cell.cx === 12 && e.cell.cy === 54);
      const sticky = game.entities.find((e: { alive: boolean; house: string; cell: { cx: number; cy: number }; mission: string }) =>
        e.alive && e.house === 'USSR' && e.cell.cx === 27 && e.cell.cy === 46 && e.mission === 'STICKY');
      return {
        e1: e1 ? { id: e1.id, m: e1.mission, mt: e1.missionTimer } : null,
        sticky: sticky ? { id: sticky.id, m: sticky.mission, mt: sticky.missionTimer, t: sticky.type } : null,
      };
    });

    console.log(`tick ${t}: WASM=${JSON.stringify(wasm)} TS=${JSON.stringify(ts)}`);
  }

  await wasmCtx.close();
  await tsCtx.close();
});
