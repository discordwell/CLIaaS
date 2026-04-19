/**
 * Trace which team contains entity 109 using getActiveTeams + deep state dump
 * across ticks 85-100. Tracks isMoving, isReforming, currentMission, isUnderStrength,
 * to identify the exact tick coordinatePatrol becomes active for this team.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA team w/ ent[109] trace 85-100', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();

  const wasmCtx = await browser.newContext();
  const wasmPage = await wasmCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });
  await wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG13EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' });
  await wasmPage.waitForFunction(() => {
    try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });
  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state','string',[],[])).rngState);
  await wasmCtx.close();

  await page.goto(`${BASE_URL}?anttest=agent&scenario=SCG13EA&difficulty=normal`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });
  await page.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  for (let t = 0; t < 85; t++) {
    await page.evaluate(() => { (window as any).__agentStep?.(1); });
  }

  for (let t = 86; t <= 101; t++) {
    await page.evaluate(() => { (window as any).__agentStep?.(1); });
    const data = await page.evaluate(() => {
      const game = (window as any).__agentGame;
      const e = game.entities.find((ent: { id: number }) => ent.id === 109);
      // Walk the full _activeTeams — need to import, but we can reach via module
      // Actually agentHarness's __agentTeams returns getActiveTeams() wrapped —
      // rewrite to expose raw Team objects temporarily via window.
      const rawTeams: Array<{ id?: number; house?: number; isMoving?: boolean; isReforming?: boolean; isUnderStrength?: boolean; currentMission?: number; missionList?: Array<{ mission: string; data: number }>; timeOut?: number; zone?: { x: number; y: number } | null; _members?: Array<{ id: number; type: string; mission: string }> }> = (window as any).__rawTeams?.() ?? [];
      let containing: typeof rawTeams[number] | null = null;
      for (const t of rawTeams) {
        if (t._members?.some((m) => m.id === 109)) { containing = t; break; }
      }
      return {
        e: e ? { m: e.mission, mt: e.missionTimer, cx: e.cell.cx, cy: e.cell.cy } : null,
        activeTeamCount: rawTeams.length,
        teamSummaries: rawTeams.map(t => ({
          id: t.id, house: t.house,
          isMoving: t.isMoving, isReforming: t.isReforming, isUnderStrength: t.isUnderStrength,
          currentMission: t.currentMission,
          missionType: t.missionList?.[t.currentMission ?? 0]?.mission,
          timeOut: t.timeOut,
          zone: t.zone,
          memberCount: t._members?.length ?? 0,
          memberIds: t._members?.map((m) => m.id).slice(0, 5),
        })),
        containing: containing ? { id: containing.id, mission: containing.missionList?.[containing.currentMission ?? 0]?.mission, cm: containing.currentMission, to: containing.timeOut } : null,
      };
    });
    console.log(`tick ${t}: ${JSON.stringify(data)}`);
  }

  await ctx.close();
});
