/**
 * Probe ALL infantry firing Mission_Guard at tick 101 (mt was 0 at tick 100 end).
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA all infantry fires at tick 101', async ({ browser }) => {
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

  // Step to end of tick 100 (so we capture mt at that point)
  for (let t = 0; t < 100; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  // Capture all E1/E3 with mt <= 1 (about to fire) at tick 100 end
  const wasmAbout = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    const all = [...(s.units ?? []), ...(s.enemies ?? [])];
    return all
      .filter((u: { t: string; m: number; mt: number }) =>
        (u.t === 'E1' || u.t === 'E3') && (u.m === 5 || u.m === 6) && u.mt <= 1)
      .map((u: { id: number; t: string; house: string; cx: number; cy: number; m: number; mt: number }) =>
        ({ id: u.id, t: u.t, h: u.house, c: `(${u.cx},${u.cy})`, m: u.m, mt: u.mt }));
  });

  const tsAbout = await tsPage.evaluate(() => {
    const game = (window as any).__agentGame;
    if (!game) return null;
    return game.entities
      .filter((e: { alive: boolean; type: string; mission: string; missionTimer: number }) =>
        e.alive && (e.type === 'E1' || e.type === 'E3') &&
        (e.mission === 'GUARD' || e.mission === 'STICKY') && e.missionTimer <= 1)
      .map((e: { id: number; type: string; house: string; cell: { cx: number; cy: number }; mission: string; missionTimer: number }) =>
        ({ id: e.id, t: e.type, h: e.house, c: `(${e.cell.cx},${e.cell.cy})`, m: e.mission, mt: e.missionTimer }));
  });

  // Specifically check USSR E1 at (61,67) and (62,78) — full state
  const tsSpecific = await tsPage.evaluate(() => {
    const game = (window as any).__agentGame;
    if (!game) return null;
    return game.entities
      .filter((e: { alive: boolean; house: string; cell: { cx: number; cy: number }; type: string }) =>
        e.alive && e.house === 'USSR' && e.type === 'E1' &&
        ((e.cell.cx === 61 && e.cell.cy === 67) || (e.cell.cx === 62 && e.cell.cy === 78)))
      .map((e: { id: number; type: string; house: string; cell: { cx: number; cy: number };
                  mission: string; missionTimer: number; missionQueue: string | null;
                  moveTarget: { lx: number; ly: number } | null; isDriving: boolean;
                  path: { cx: number; cy: number }[]; pathIndex: number; teamRef?: { id: number } }) =>
        ({ id: e.id, t: e.type, h: e.house, c: `(${e.cell.cx},${e.cell.cy})`,
           m: e.mission, mt: e.missionTimer, mq: e.missionQueue,
           mTgt: e.moveTarget ? `(${e.moveTarget.lx},${e.moveTarget.ly})` : 'null',
           drv: e.isDriving, pLen: e.path?.length, pIdx: e.pathIndex,
           team: e.teamRef?.id ?? 'null' }));
  });
  console.log(`\n=== TS USSR E1 specific units at tick 100 end ===`);
  for (const e of tsSpecific ?? []) console.log(JSON.stringify(e));

  // WASM equivalent
  const wasmSpecific = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    const all = [...(s.units ?? []), ...(s.enemies ?? [])];
    return all
      .filter((u: { house: string; t: string; cx: number; cy: number }) =>
        u.house === 'USSR' && u.t === 'E1' &&
        ((u.cx === 61 && u.cy === 67) || (u.cx === 62 && u.cy === 78)))
      .map((u: { id: number; t: string; cx: number; cy: number; m: number; mt: number; mq: number; nav: number; drv: boolean }) =>
        ({ id: u.id, t: u.t, c: `(${u.cx},${u.cy})`, m: u.m, mt: u.mt, mq: u.mq, nav: u.nav, drv: u.drv }));
  });
  console.log(`=== WASM USSR E1 specific units at tick 100 end ===`);
  for (const u of wasmSpecific) console.log(JSON.stringify(u));

  console.log(`=== WASM E1/E3 about to fire at tick 100 end (${wasmAbout.length}) ===`);
  for (const u of wasmAbout) console.log(`  id=${u.id} ${u.t} ${u.h} ${u.c} m=${u.m} mt=${u.mt}`);
  console.log(`=== TS E1/E3 about to fire at tick 100 end (${tsAbout?.length}) ===`);
  for (const e of tsAbout ?? []) console.log(`  id=${e.id} ${e.t} ${e.h} ${e.c} m=${e.m} mt=${e.mt}`);

  await wasmCtx.close();
  await tsCtx.close();
});
