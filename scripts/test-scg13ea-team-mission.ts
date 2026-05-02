/**
 * Trace WASM team's mission state for the team containing USSR E1 (61,67).
 * Find what triggers mq=GUARD on the unit at tick 99.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA WASM team mission trace', async ({ browser }) => {
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

  // Step to tick 95
  for (let t = 0; t < 95; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  // Probe ticks 95-103 — both WASM team state and TS team state
  for (let t = 95; t <= 103; t++) {
    const wasmTeams = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      return (s.teams ?? []).filter((t: { cls: string }) => t.cls === 'nptrl');
    });
    const tsTeam = await tsPage.evaluate(() => {
      const game = (window as any).__agentGame;
      // Access team via the unit's teamRef
      const e = game.entities.find((x: { id: number }) => x.id === 109);
      if (!e?.teamRef) return null;
      const t = e.teamRef;
      return {
        id: t.id, isMoving: t.isMoving, isNextMission: t.isNextMission,
        currentMission: t.currentMission,
        missionList: t.missionList?.map((m: { mission: number; data: number }) => `${m.mission}:${m.data}`),
        target: t.target,
        missionTarget: t.missionTarget,
        memberMissions: t._members?.map((m: { id: number; mission: string; missionTimer: number; missionQueue: string | null }) =>
          `${m.id}:${m.mission}/mt=${m.missionTimer}/mq=${m.missionQueue}`),
      };
    });
    // Also probe unit 852056/109 state
    const wasmUnit = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      const all = [...(s.units ?? []), ...(s.enemies ?? [])];
      const u = all.find((x: { id: number }) => x.id === 852056);
      return u ? { m: u.m, mt: u.mt, mq: u.mq, drv: u.drv, doing: u.doing, nlx: u.nlx, nly: u.nly, lx: u.lx, ly: u.ly } : null;
    });
    console.log(`tick ${t}:`);
    console.log(`  WASM teams: ${JSON.stringify(wasmTeams).slice(0, 500)}`);
    console.log(`  WASM unit 852056: ${JSON.stringify(wasmUnit)}`);
    console.log(`  TS team 2: ${JSON.stringify(tsTeam)}`);

    if (t < 103) {
      await Promise.all([
        wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
        tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
      ]);
    }
  }

  await wasmCtx.close();
  await tsCtx.close();
});
