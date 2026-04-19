/**
 * Trace TS team state across ticks 85-105 for SCG13EA.
 * Find which team contains the E1 at (61,67) and track its activation/move
 * decision timing vs when the mission actually flips.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA team coordinator trace 85-105', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const tsPage = await tsCtx.newPage();

  // Sync seed from WASM
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

  // Step to tick 85
  for (let t = 0; t < 85; t++) {
    await tsPage.evaluate(() => { (window as any).__agentStep?.(1); });
  }

  // Trace ticks 85-105
  for (let t = 86; t <= 105; t++) {
    await tsPage.evaluate(() => { (window as any).__agentStep?.(1); });

    const data = await tsPage.evaluate(() => {
      const game = (window as any).__agentGame;
      const teams = (window as any).__agentTeams?.() ?? [];
      // Find entity id=109 (E1 USSR at (61,67))
      const e = game.entities.find((ent: { id: number }) => ent.id === 109);
      if (!e) return { e: null, teams };
      // Find which team contains this entity
      let myTeam: { i: number; house: number; isMoving: boolean; isUnderStrength: boolean; isReforming: boolean; currentMission?: number } | null = null;
      const fullTeams = game.teams ?? [];
      for (let i = 0; i < fullTeams.length; i++) {
        const team = fullTeams[i];
        if (!team || team.dissolved) continue;
        const members = team._members ?? [];
        if (members.some((m: { id: number }) => m.id === 109)) {
          myTeam = {
            i,
            house: team.house,
            isMoving: team.isMoving,
            isUnderStrength: team.isUnderStrength,
            isReforming: team.isReforming,
            currentMission: team.currentMission,
          };
          break;
        }
      }
      return {
        e: { mission: e.mission, mt: e.missionTimer, cx: e.cell.cx, cy: e.cell.cy,
             moveTarget: e.moveTarget },
        team: myTeam,
        teamMissionType: myTeam ? (() => {
          const full = fullTeams[myTeam.i];
          const m = full.missionList?.[full.currentMission];
          return m ? { type: m.mission, data: m.data } : null;
        })() : null,
      };
    });
    console.log(`tick ${t}: e=${JSON.stringify(data.e)} team=${JSON.stringify(data.team)} mission=${JSON.stringify(data.teamMissionType)}`);
  }

  await tsCtx.close();
});
