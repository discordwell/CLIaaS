/**
 * Compare TS team 2 state vs WASM team for unit id=109 (USSR E1 (61,67))
 * to understand why TS queues MOVE but WASM doesn't.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA team state comparison', async ({ browser }) => {
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

  // Step to tick 95
  for (let t = 0; t < 95; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  // TS team 2 state
  const tsTeam = await tsPage.evaluate(() => {
    const game = (window as any).__agentGame;
    if (!game) return null;
    const teams = (game as any).teams ?? Array.from((game as any)._activeTeams ?? []);
    const t2 = (teams as Array<{ id: number; house: string; missionList?: unknown[]; currentMission: number; isMoving: boolean; isReforming: boolean; target?: { x: number; y: number }; missionTarget?: { x: number; y: number }; _members?: Array<{ id: number; type: string; cell: { cx: number; cy: number } }> }>).find((t) => t.id === 2);
    if (!t2) return 'team 2 not found';
    return {
      id: t2.id, house: t2.house, missions: t2.missionList,
      currentMission: t2.currentMission, isMoving: t2.isMoving, isReforming: t2.isReforming,
      target: t2.target, missionTarget: t2.missionTarget,
      members: t2._members?.map((m) => ({ id: m.id, t: m.type, c: `(${m.cell.cx},${m.cell.cy})` })),
    };
  });
  console.log(`=== TS team 2 at tick 95 ===\n${JSON.stringify(tsTeam, null, 2)}`);

  // WASM team-id of unit 852056 (USSR E1 at 61,67)
  const wasmUnit = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    const all = [...(s.units ?? []), ...(s.enemies ?? [])];
    const u = all.find((u: { id: number }) => u.id === 852056);
    return u;
  });
  console.log(`\n=== WASM unit 852056 at tick 95 ===\n${JSON.stringify(wasmUnit, null, 2)}`);

  await wasmCtx.close();
  await tsCtx.close();
});
