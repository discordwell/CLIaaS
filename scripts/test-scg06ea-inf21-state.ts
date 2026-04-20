/**
 * Track TS infantry[21] and infantry[22] state at ticks 0-5.
 * At tick 4, TS fires 3 extra RNGs attributed to these entities (infantry[21]=2, infantry[22]=1).
 * WASM fires 0 at tick 4.
 */
import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

test('SCG06EA infantry[21,22] tick 0-5', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG06EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tsPage.goto(`${BASE_URL}?anttest=agent&scenario=SCG06EA&difficulty=normal`, { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wasmPage.waitForFunction(() => {
      try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
    }, { timeout: 180_000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);
  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state','string',[],[])).rngState);
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  for (let t = 0; t <= 5; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);

    const tsState = await tsPage.evaluate(() => {
      const game = (window as any).__agentGame;
      // Phase 1 entities (pre-building) at positions 21 and 22
      const e21 = game.entities[21] ?? null;
      const e22 = game.entities[22] ?? null;
      const fmt = (e: { id: number; type: string; house: string; cell: { cx: number; cy: number }; mission: string; missionTimer: number; doing: string; isFiringAnim: boolean; isDriving: boolean; target: unknown; guardOrigin: unknown; idleAnimTimer: number; attackCooldown: number } | null) => e ? {
        id: e.id, type: e.type, house: e.house, cell: `(${e.cell.cx},${e.cell.cy})`,
        m: e.mission, mt: e.missionTimer,
        doing: e.doing, firing: e.isFiringAnim, driving: e.isDriving,
        target: e.target ? 'set' : null,
        guardOrigin: e.guardOrigin ? 'set' : null,
        idle: e.idleAnimTimer, arm: e.attackCooldown,
      } : null;
      return { e21: fmt(e21), e22: fmt(e22) };
    });

    const wasmInf = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      const all = [...(s.units ?? []), ...(s.enemies ?? [])];
      // Match by Logic index via logicLayer if possible, else by position
      const ll = s.logicLayer ?? [];
      return ll.slice(0, 10).map((e: [number, string, string, number, number]) => e);
    });

    console.log(`tick ${t + 1}:`);
    console.log(`  TS e21: ${JSON.stringify(tsState.e21)}`);
    console.log(`  TS e22: ${JSON.stringify(tsState.e22)}`);
    if (t === 0) console.log(`  WASM logicLayer first 10: ${JSON.stringify(wasmInf)}`);
  }

  await wasmCtx.close();
  await tsCtx.close();
});
