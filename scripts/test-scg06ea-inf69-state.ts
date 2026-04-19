/**
 * SCG06EA infantry[69] (E1 USSR at 24,67) state at tick 0 and 1.
 * WASM fires 2 Mission_Guard_Area Random_Pick calls at tick 1; TS fires 0.
 * Check what mission, missionTimer, target state TS has.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG06EA infantry[69] tick 0/1 state', async ({ browser }) => {
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

  for (let tick = 0; tick <= 3; tick++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);

    const wasmInf69 = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      const all = [...(s.units ?? []), ...(s.enemies ?? [])];
      // Find USSR E1 at (24,67)
      const inf = all.find((u: { t: string; house: string; cx: number; cy: number }) =>
        u.t === 'E1' && u.house === 'USSR' && u.cx === 24 && u.cy === 67);
      return inf;
    });

    const tsInf69 = await tsPage.evaluate(() => {
      const game = (window as any).__agentGame;
      const e = game.entities.find((ent: { alive: boolean; type: string; house: string; cell: { cx: number; cy: number } }) =>
        ent.alive && ent.type === 'E1' && ent.house === 'USSR' && ent.cell.cx === 24 && ent.cell.cy === 67);
      if (!e) return null;
      return {
        id: e.id, m: e.mission, mt: e.missionTimer,
        doing: e.doing, idle: e.idleAnimTimer,
        cx: e.cell.cx, cy: e.cell.cy,
        tgt: e.target ? `${e.target.type}@${e.target.cell?.cx},${e.target.cell?.cy}` : null,
        guardOrigin: e.guardOrigin,
      };
    });

    console.log(`tick ${tick + 1}:`);
    console.log(`  WASM: ${JSON.stringify(wasmInf69)}`);
    console.log(`  TS:   ${JSON.stringify(tsInf69)}`);
  }

  await wasmCtx.close();
  await tsCtx.close();
});
