/**
 * Find what TS entity is at the position after logicIdx 147 at tick 42 end.
 * WASM continues to infantry[192] at this point in tick 43 iteration.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA TS iteration order at tick 42 end', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const tsPage = await tsCtx.newPage();

  await tsPage.goto(`${BASE_URL}?anttest=agent&scenario=SCG13EA&difficulty=normal`, { waitUntil: 'load' });
  await tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });

  // Sync with a common seed (WASM baseline)
  const wasmCtx = await browser.newContext();
  const wasmPage = await wasmCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });
  await wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG13EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' });
  await wasmPage.waitForFunction(() => {
    try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });
  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state','string',[],[])).rngState);
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);
  await wasmCtx.close();

  for (let t = 0; t < 42; t++) {
    await tsPage.evaluate(() => { (window as any).__agentStep?.(1); });
  }

  // Dump TS entity iteration order (index order)
  const tsIter = await tsPage.evaluate(() => {
    const game = (window as any).__agentGame;
    if (!game) return null;
    // Phase 1: pre-building entities
    const preCount = game._preBuildingEntityCount ?? game.entities.length;
    const phase1 = game.entities.slice(0, preCount);
    const phase3 = game.entities.slice(preCount);
    return {
      preCount,
      phase1: phase1.map((e: { id: number; type: string; house: string; cell: { cx: number; cy: number }; mission: string; missionTimer: number; alive: boolean; inLimbo: boolean; isAirUnit: boolean; stats: { isInfantry: boolean; isVessel: boolean } }, i: number) => ({
        logicPos: i, id: e.id, type: e.type, house: e.house,
        cx: e.cell.cx, cy: e.cell.cy, mission: e.mission, mt: e.missionTimer,
        alive: e.alive, inLimbo: e.inLimbo, isAir: e.isAirUnit,
        isInf: e.stats.isInfantry, isVes: e.stats.isVessel,
      })),
      phase3: phase3.map((e: { id: number; type: string; house: string; cell: { cx: number; cy: number }; mission: string; missionTimer: number; alive: boolean; inLimbo: boolean; isAirUnit: boolean; stats: { isInfantry: boolean; isVessel: boolean } }, i: number) => ({
        logicPos: preCount + i, id: e.id, type: e.type, house: e.house,
        cx: e.cell.cx, cy: e.cell.cy, mission: e.mission, mt: e.missionTimer,
        alive: e.alive, inLimbo: e.inLimbo, isAir: e.isAirUnit,
        isInf: e.stats.isInfantry, isVes: e.stats.isVessel,
      })),
    };
  });

  if (!tsIter) { console.log('TS state null'); return; }
  console.log(`TS preBuildingEntityCount: ${tsIter.preCount}`);
  console.log(`\n=== TS Phase 1 entities at logicIdx 140+ ===`);
  for (const e of tsIter.phase1.filter((e: { logicPos: number }) => e.logicPos >= 140)) {
    console.log(`  [${e.logicPos}] id=${e.id} t=${e.type} (${e.cx},${e.cy}) m=${e.mission} mt=${e.mt} alive=${e.alive} limbo=${e.inLimbo} air=${e.isAir} inf=${e.isInf} ves=${e.isVes}`);
  }
  console.log(`\n=== TS Phase 3 entities ===`);
  for (const e of tsIter.phase3) {
    console.log(`  [${e.logicPos}] id=${e.id} t=${e.type} (${e.cx},${e.cy}) m=${e.mission} mt=${e.mt} alive=${e.alive} limbo=${e.inLimbo} air=${e.isAir} inf=${e.isInf} ves=${e.isVes}`);
  }

  await tsCtx.close();
});
