/**
 * Probe ALL WASM teams + units at tick 113-114 to identify why TS over-fires.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG13EA t114 teams probe', async ({ browser }) => {
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

  for (let t = 0; t < 113; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  for (let t = 113; t <= 115; t++) {
    const teams = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      return (s.teams ?? []).map((tm: { i: number; cls: string; cur: number; next?: boolean; lag?: boolean; tgtX: number; tgtY: number; mtgtX: number; mtgtY: number; missions: unknown[] }) =>
        ({ i: tm.i, cls: tm.cls, cur: tm.cur, next: tm.next, lag: tm.lag, tgt: `(${tm.tgtX},${tm.tgtY})`, mtgt: `(${tm.mtgtX},${tm.mtgtY})`, missions: tm.missions }));
    });
    const tsTeams = await tsPage.evaluate(() => {
      const game = (window as any).__agentGame;
      const teams = Array.from(new Set(
        game.entities
          .filter((e: { alive: boolean; type: string; house: string; teamRef?: unknown }) =>
            e.alive && e.type === 'E1' && e.house === 'USSR' && e.teamRef)
          .map((e: { teamRef: unknown }) => e.teamRef)
      )) as Array<any>;
      return teams.map((tm) => ({
        id: tm.id,
        cur: tm.currentMission,
        next: tm.isNextMission,
        tgt: tm.target,
        mtgt: tm.missionTarget,
        missions: tm.missionList?.map((m: { mission: number; data: number }) => `${m.mission}:${m.data}`),
        members: tm._members?.map((m: any) => `${m.id}:${m.mission}/mt=${m.missionTimer}/mq=${m.missionQueue}/drv=${m.isDriving}/init=${m.teamInitiated}`),
      }));
    });
    console.log(`tick ${t} teams:`);
    console.log('  WASM');
    for (const tm of teams) console.log(`    ${JSON.stringify(tm)}`);
    console.log('  TS');
    for (const tm of tsTeams) console.log(`    ${JSON.stringify(tm)}`);

    if (t < 115) {
      await Promise.all([
        wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
        tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
      ]);
    }
  }

  await wasmCtx.close();
  await tsCtx.close();
});
