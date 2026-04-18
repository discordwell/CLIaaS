/**
 * SCG04EA unit[1]/unit[2] timer inspection tick-by-tick.
 * Usage: npx playwright test scripts/test-scg04ea-units.ts
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test(`SCG04EA unit timers`, async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG04EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tsPage.goto(`${BASE_URL}?anttest=agent&scenario=SCG04EA&difficulty=normal`, { waitUntil: 'load' }),
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

  const wasmSeed = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;
  });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  for (let step = 0; step <= 3; step++) {
    if (step > 0) {
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
        units: [...(s.units ?? []), ...(s.enemies ?? [])].filter((u: { t: string }) => u.t === '3TNK' || u.t === 'JEEP' || u.t === 'HARV' || u.t === '4TNK' || u.t === 'V2RL'),
      };
    });

    const tsState = await tsPage.evaluate(() => {
      const game = (window as any).__agentGame;
      if (!game) return null;
      return {
        tick: game.tick,
        units: game.entities.filter((e: { alive: boolean; type: string }) =>
          e.alive && ['3TNK', 'JEEP', 'HARV', '4TNK', 'V2RL'].includes(e.type),
        ).map((e: { id: number; type: string; house: string; mission: string; missionTimer: number; attackCooldown: number }) => ({
          id: e.id, t: e.type, house: e.house, mission: e.mission, mt: e.missionTimer, arm: e.attackCooldown,
        })),
      };
    });

    console.log(`\n=== After step ${step} ===`);
    console.log(`WASM tick=${wasmState.tick}`);
    for (const u of wasmState.units) {
      console.log(`  ${JSON.stringify(u)}`);
    }
    console.log(`TS tick=${tsState?.tick}`);
    for (const u of tsState?.units ?? []) {
      console.log(`  ${JSON.stringify(u)}`);
    }
  }

  await wasmCtx.close();
  await tsCtx.close();
});
