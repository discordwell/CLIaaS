/**
 * Probe SCG07EA tick 17 infantry 126/129 state in both engines.
 * Phase 7A should have closed 5 calls (3 Random_Animate + 2 60043 jitters)
 * but actual Δcalls=7 — investigate why.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG07EA t17 infantry probe', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG07EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tsPage.goto(`${BASE_URL}?anttest=agent&scenario=SCG07EA&difficulty=normal`, { waitUntil: 'load' }),
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

  for (let t = 0; t < 17; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  // WASM infantry 126, 129 are at cells (67,66) and (66,66) per test docs
  const wasm = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    const all = [...(s.units ?? []), ...(s.enemies ?? [])];
    return all
      .filter((u: { t: string; cx: number; cy: number; house: string }) =>
        u.t === 'E1' && u.house === 'USSR' &&
        ((u.cx === 67 && u.cy === 66) || (u.cx === 66 && u.cy === 66)))
      .map((u: { id: number; cx: number; cy: number; m: number; mt: number; mq: number; doing: number; idle: number; firing: boolean }) =>
        ({ id: u.id, c: `(${u.cx},${u.cy})`, m: u.m, mt: u.mt, mq: u.mq, doing: u.doing, idle: u.idle, firing: u.firing }));
  });
  console.log(`=== WASM USSR E1 (67,66)/(66,66) at tick 17 end ===`);
  for (const u of wasm) console.log(JSON.stringify(u));

  const ts = await tsPage.evaluate(() => {
    const game = (window as any).__agentGame;
    if (!game) return null;
    return game.entities
      .filter((e: { alive: boolean; type: string; house: string; cell: { cx: number; cy: number } }) =>
        e.alive && e.type === 'E1' && e.house === 'USSR' &&
        ((e.cell.cx === 67 && e.cell.cy === 66) || (e.cell.cx === 66 && e.cell.cy === 66)))
      .map((e: { id: number; cell: { cx: number; cy: number }; mission: string; missionTimer: number; missionQueue: string | null; doing: string; idleAnimTimer: number; isFiringAnim: boolean; nonInterruptAnimTicks: number }) =>
        ({ id: e.id, c: `(${e.cell.cx},${e.cell.cy})`, m: e.mission, mt: e.missionTimer, mq: e.missionQueue, doing: e.doing, idle: e.idleAnimTimer, firing: e.isFiringAnim, niat: e.nonInterruptAnimTicks }));
  });
  console.log(`\n=== TS USSR E1 (67,66)/(66,66) at tick 17 end ===`);
  for (const e of ts ?? []) console.log(JSON.stringify(e));

  await wasmCtx.close();
  await tsCtx.close();
});
