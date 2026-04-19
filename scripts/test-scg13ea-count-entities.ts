/**
 * Task #43 deep dive: compare TS vs WASM entity counts + mission states at tick 43.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA entity counts at tick 43', async ({ browser }) => {
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

  const targetTick = Number(process.env.TICK ?? 42);
  // Step to end of target tick (before next tick AI)
  for (let t = 0; t < targetTick; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  const wasmState = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    const all = [...(s.units ?? []), ...(s.enemies ?? [])];
    const byMission: Record<string, number> = {};
    for (const u of all) {
      const key = `m${u.m}_mt${u.mt}`;
      byMission[key] = (byMission[key] ?? 0) + 1;
    }
    return {
      tick: s.tick,
      total: all.length,
      byMission,
      logicLayer: s.logicLayer?.length ?? 0,
    };
  });

  const tsState = await tsPage.evaluate(() => {
    const game = (window as any).__agentGame;
    if (!game) return null;
    const all = game.entities.filter((e: { alive: boolean; inLimbo: boolean }) => e.alive && !e.inLimbo);
    const byMission: Record<string, number> = {};
    for (const e of all) {
      const key = `m${e.mission}_mt${e.missionTimer}`;
      byMission[key] = (byMission[key] ?? 0) + 1;
    }
    return { tick: game.tick, total: all.length, byMission };
  });

  console.log('=== TICK 42 END ===');
  console.log(`WASM: tick=${wasmState.tick} total=${wasmState.total} logicLayer=${wasmState.logicLayer}`);
  console.log(`TS:   tick=${tsState?.tick} total=${tsState?.total}`);
  console.log('\nWASM mission-timer distribution:');
  const wmKeys = Object.keys(wasmState.byMission).sort();
  for (const k of wmKeys) console.log(`  ${k}: ${wasmState.byMission[k]}`);
  console.log('\nTS mission-timer distribution:');
  const tmKeys = Object.keys(tsState!.byMission).sort();
  for (const k of tmKeys) console.log(`  ${k}: ${tsState!.byMission[k]}`);

  await wasmCtx.close();
  await tsCtx.close();
});
