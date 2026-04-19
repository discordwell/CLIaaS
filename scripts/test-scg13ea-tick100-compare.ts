/**
 * Compare WASM infantry[153] vs TS logicIdx 153 state at SCG13EA tick 99 end.
 * This entity fires Mission_Move Random_Pick at tick 100 in WASM but not in TS.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA tick 99 entity[153] WASM vs TS state diff', async ({ browser }) => {
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
      try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
    }, { timeout: 180_000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);

  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state','string',[],[])).rngState);
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  // Step to tick 99 END
  for (let t = 0; t < 99; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  // WASM: find infantry with Logic index 153 via logicLayer cell → match infantry by cell+type
  const wasmEnt = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    const layer = (s.logicLayer ?? []) as Array<[number, string, string, number, number]>;
    const entry = layer[153]; // array index 153
    if (!entry) return { err: 'no-layer-153', layerLen: layer.length };
    const [idx, t, h, cx, cy] = entry;
    const all = [...(s.units ?? []), ...(s.enemies ?? [])];
    const match = all.find((u: { t: string; house: string; cx: number; cy: number }) =>
      u.t === t && u.house === h && u.cx === cx && u.cy === cy);
    return { idx, t, h, cx, cy, match };
  });

  const tsEnt = await tsPage.evaluate(() => {
    const game = (window as any).__agentGame;
    if (!game) return null;
    const e = game.entities[153];
    if (!e) return { err: 'no-entity-153', entLen: game.entities.length };
    return {
      id: e.id, type: e.type, house: e.house,
      cx: e.cell.cx, cy: e.cell.cy,
      mission: e.mission, mt: e.missionTimer,
      alive: e.alive, inLimbo: e.inLimbo,
      moveTarget: e.moveTarget, pathLen: e.path?.length, pathIdx: e.pathIndex,
      target: e.target ? `${e.target.type}@${e.target.cell?.cx},${e.target.cell?.cy}` : null,
      doing: e.doing, idle: e.idleAnimTimer,
    };
  });

  console.log('=== WASM Logic[153] ===');
  console.log(JSON.stringify(wasmEnt, null, 2));
  console.log('\n=== TS entities[153] ===');
  console.log(JSON.stringify(tsEnt, null, 2));

  // Also find TS entity at matching cell in case logicIdx order differs
  const tsMatch = await tsPage.evaluate(() => {
    const game = (window as any).__agentGame;
    if (!game) return null;
    return game.entities
      .filter((e: { alive: boolean; inLimbo: boolean; cell: { cx: number; cy: number }; type: string }) =>
        e.alive && !e.inLimbo && e.cell.cx === 61 && e.cell.cy === 67 && e.type === 'E1')
      .map((e: { id: number; type: string; house: string; mission: string; missionTimer: number; moveTarget: unknown; path: unknown[]; pathIndex: number }) => ({
        id: e.id, t: e.type, h: e.house, m: e.mission, mt: e.missionTimer,
        moveTarget: e.moveTarget, pathLen: e.path?.length, pathIdx: e.pathIndex,
      }));
  });
  console.log('\n=== TS entities at cell (61,67) E1 ===');
  console.log(JSON.stringify(tsMatch, null, 2));

  await wasmCtx.close();
  await tsCtx.close();
});
