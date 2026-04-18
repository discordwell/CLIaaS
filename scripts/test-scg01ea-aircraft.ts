/**
 * ${scenario} aircraft state check tick 1 - verify Chinook reinforcement
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';
const scenario = process.env.SCENARIO ?? 'SCG01EA';

test(`${scenario} aircraft check`, async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=${scenario}.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tsPage.goto(`${BASE_URL}?anttest=agent&scenario=${scenario}&difficulty=normal`, { waitUntil: 'load' }),
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

  for (let step = 0; step <= 2; step++) {
    if (step > 0) {
      await Promise.all([
        wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
        tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
      ]);
    }

    const wasm = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      return {
        tick: s.tick,
        aircraft: [...(s.units ?? []), ...(s.enemies ?? [])].filter((u: { t: string }) =>
          u.t === 'TRAN' || u.t === 'HELI' || u.t === 'YAK' || u.t === 'MIG' || u.t === 'HIND'),
        teams: s.teams ?? [],
      };
    });
    const ts = await tsPage.evaluate(() => {
      const game = (window as any).__agentGame;
      if (!game) return null;
      return {
        tick: game.tick,
        aircraft: game.entities.filter((e: { alive: boolean; type: string }) =>
          ['TRAN', 'HELI', 'YAK', 'MIG', 'HIND'].includes(e.type),
        ).map((e: { id: number; type: string; house: string; mission: string; missionTimer: number; alive: boolean; inLimbo: boolean; flightAltitude: number; passengers?: Array<{ type: string }> }) => ({
          id: e.id, t: e.type, house: e.house, mission: e.mission, mt: e.missionTimer,
          alive: e.alive, inLimbo: e.inLimbo, alt: e.flightAltitude,
          cargo: e.passengers?.length ?? 0,
          cargoTypes: (e.passengers ?? []).map(p => p.type),
        })),
        tanyas: game.entities.filter((e: { alive: boolean; type: string }) =>
          e.type === 'E7',
        ).map((e: { id: number; house: string; mission: string; alive: boolean; inLimbo: boolean }) => ({
          id: e.id, house: e.house, mission: e.mission, alive: e.alive, inLimbo: e.inLimbo,
        })),
        teams: (window as any).__agentTeams?.() ?? [],
      };
    });

    console.log(`\n=== Step ${step} ===`);
    console.log(`WASM tick=${wasm.tick}, aircraft=${wasm.aircraft.length}, teams=${wasm.teams.length}`);
    for (const a of wasm.aircraft) console.log(`  ac ${JSON.stringify(a)}`);
    for (const t of wasm.teams) console.log(`  team ${JSON.stringify(t)}`);
    console.log(`TS tick=${ts?.tick}, aircraft=${ts?.aircraft.length ?? 0}, teams=${ts?.teams.length ?? 0}`);
    for (const a of ts?.aircraft ?? []) console.log(`  ac ${JSON.stringify(a)}`);
    for (const t of ts?.teams ?? []) console.log(`  team ${JSON.stringify(t)}`);
    for (const t of ts?.tanyas ?? []) console.log(`  tanya ${JSON.stringify(t)}`);
  }

  await wasmCtx.close();
  await tsCtx.close();
});
