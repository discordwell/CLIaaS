/**
 * Task #43: Compare WASM vs TS entity state for the E1 USSR STICKY at cell (27,46)
 * at tick 43 — the point where TS fires 3 RNG but WASM fires 1.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA state diff at tick 43', async ({ browser }) => {
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
      const M = (window as any).Module;
      return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0;
    }, { timeout: 180_000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);

  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state','string',[],[])).rngState);
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  // Step to end of tick 42 (before tick 43 processing)
  for (let t = 0; t < 42; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  const wasmState = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    return {
      tick: s.tick,
      infantry: [...(s.units ?? []), ...(s.enemies ?? [])]
        .filter((u: { t: string; cx: number; cy: number }) => u.t === 'E1' && u.cx === 27 && u.cy === 46),
    };
  });

  const tsState = await tsPage.evaluate(() => {
    const game = (window as any).__agentGame;
    if (!game) return null;
    return {
      tick: game.tick,
      infantry: game.entities
        .filter((e: { alive: boolean; type: string; cell: { cx: number; cy: number }; house: string }) =>
          e.alive && e.type === 'E1' && e.cell.cx === 27 && e.cell.cy === 46)
        .map((e: { id: number; type: string; house: string; mission: string; missionTimer: number; idleAnimTimer: number; doing: string; isFiringAnim: boolean; isProne: boolean; isDriving: boolean; target: unknown; attackCooldown: number }) => ({
          id: e.id, t: e.type, house: e.house, mission: e.mission,
          mt: e.missionTimer, idle: e.idleAnimTimer, doing: e.doing,
          firing: e.isFiringAnim, prone: e.isProne, driving: e.isDriving,
          hasTarget: !!e.target, arm: e.attackCooldown,
        })),
    };
  });

  console.log('=== TICK 42 END ===');
  console.log('WASM:', JSON.stringify(wasmState, null, 2));
  console.log('TS:  ', JSON.stringify(tsState, null, 2));

  await wasmCtx.close();
  await tsCtx.close();
});
