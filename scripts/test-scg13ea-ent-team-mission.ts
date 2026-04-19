/**
 * Dump entity 109's teamMissions + teamMissionIndex through ticks 85-105.
 * Also capture waypoint table to resolve where the unit is heading.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA ent[109] team mission trace', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const tsPage = await tsCtx.newPage();

  const wasmCtx = await browser.newContext();
  const wasmPage = await wasmCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });
  await wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG13EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' });
  await wasmPage.waitForFunction(() => {
    try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });
  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state','string',[],[])).rngState);
  await wasmCtx.close();

  await tsPage.goto(`${BASE_URL}?anttest=agent&scenario=SCG13EA&difficulty=normal`, { waitUntil: 'load' });
  await tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  for (let t = 0; t < 85; t++) {
    await tsPage.evaluate(() => { (window as any).__agentStep?.(1); });
  }

  // Dump initial team missions + waypoints
  const initial = await tsPage.evaluate(() => {
    const game = (window as any).__agentGame;
    const e = game.entities.find((ent: { id: number }) => ent.id === 109);
    const wps: Array<[number, { cx: number; cy: number }]> = [];
    if (game.waypoints instanceof Map) {
      for (const [k, v] of game.waypoints.entries()) wps.push([k, v]);
    }
    return {
      teamMissions: e?.teamMissions?.map((m: { mission: string; data: number }) => ({ m: m.mission, d: m.data })) ?? [],
      waypoints: wps.slice(0, 40),
      e: e ? { id: e.id, isInTeam: e.isInTeam, guardOrigin: e.guardOrigin } : null,
    };
  });
  console.log('=== Initial entity[109] team state + waypoints ===');
  console.log(JSON.stringify(initial, null, 2));

  for (let t = 86; t <= 105; t++) {
    await tsPage.evaluate(() => { (window as any).__agentStep?.(1); });
    const d = await tsPage.evaluate(() => {
      const game = (window as any).__agentGame;
      const e = game.entities.find((ent: { id: number }) => ent.id === 109);
      if (!e) return null;
      const tmCurrent = e.teamMissions?.[e.teamMissionIndex];
      return {
        m: e.mission, mt: e.missionTimer, cx: e.cell.cx, cy: e.cell.cy,
        tmIdx: e.teamMissionIndex,
        tm: tmCurrent ? { t: tmCurrent.mission, d: tmCurrent.data } : null,
        mtarget: e.moveTarget,
      };
    });
    console.log(`tick ${t}: ${JSON.stringify(d)}`);
  }

  await tsCtx.close();
});
