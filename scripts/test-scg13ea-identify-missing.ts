/**
 * Identify WHICH entity WASM infantry[192] corresponds to in TS at tick 42 end.
 * Then see why it doesn't fire at tick 43.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA identify missing TS entity', async ({ browser }) => {
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

  for (let t = 0; t < 42; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  // Dump every GUARD + STICKY entity at tick 42 end with position, house, type
  const wasmState = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    const all = [...(s.units ?? []), ...(s.enemies ?? [])];
    return all
      .filter((u: { m: number }) => u.m === 5 || u.m === 6) // GUARD (5) or STICKY (6)
      .map((u: { id: number; t: string; house: string; cx: number; cy: number; m: number; mt: number; arm: number; doing?: number; idle?: number; firing?: boolean; prone?: boolean }) => ({
        id: u.id, t: u.t, house: u.house, cx: u.cx, cy: u.cy,
        m: u.m, mt: u.mt, arm: u.arm, doing: u.doing, idle: u.idle,
        firing: u.firing, prone: u.prone,
      }))
      .sort((a, b) => a.id - b.id);
  });

  const tsState = await tsPage.evaluate(() => {
    const game = (window as any).__agentGame;
    if (!game) return null;
    return game.entities
      .filter((e: { alive: boolean; inLimbo: boolean; mission: string }) =>
        e.alive && !e.inLimbo && (e.mission === 'GUARD' || e.mission === 'STICKY'))
      .map((e: { id: number; type: string; house: string; cell: { cx: number; cy: number }; mission: string; missionTimer: number; attackCooldown: number; doing: string; idleAnimTimer: number; isFiringAnim: boolean; isProne: boolean }) => ({
        id: e.id, t: e.type, house: e.house, cx: e.cell.cx, cy: e.cell.cy,
        mission: e.mission, mt: e.missionTimer, arm: e.attackCooldown,
        doing: e.doing, idle: e.idleAnimTimer, firing: e.isFiringAnim, prone: e.isProne,
      }))
      .sort((a: { id: number }, b: { id: number }) => a.id - b.id);
  });

  console.log(`=== WASM GUARD/STICKY entities at tick 42 end (${wasmState.length}) ===`);
  for (const e of wasmState) {
    console.log(`  id=${e.id} t=${e.t} house=${e.house} (${e.cx},${e.cy}) m=${e.m} mt=${e.mt} arm=${e.arm} doing=${e.doing} idle=${e.idle} firing=${e.firing} prone=${e.prone}`);
  }
  console.log(`\n=== TS GUARD/STICKY entities at tick 42 end (${tsState?.length}) ===`);
  for (const e of tsState ?? []) {
    console.log(`  id=${e.id} t=${e.t} house=${e.house} (${e.cx},${e.cy}) m=${e.mission} mt=${e.mt} arm=${e.arm} doing=${e.doing} idle=${e.idle} firing=${e.firing} prone=${e.prone}`);
  }

  // Compare by cell: multiple entities can share a cell — use multiset
  const tsCellCounts = new Map<string, number>();
  for (const e of tsState ?? []) {
    const k = `${e.cx},${e.cy}`;
    tsCellCounts.set(k, (tsCellCounts.get(k) ?? 0) + 1);
  }
  const wasmCellCounts = new Map<string, number>();
  for (const e of wasmState) {
    const k = `${e.cx},${e.cy}`;
    wasmCellCounts.set(k, (wasmCellCounts.get(k) ?? 0) + 1);
  }
  console.log(`\n=== Cells where WASM count > TS count ===`);
  for (const [k, wc] of wasmCellCounts.entries()) {
    const tc = tsCellCounts.get(k) ?? 0;
    if (wc > tc) console.log(`  ${k}: WASM=${wc} TS=${tc}`);
  }
  console.log(`\n=== Cells where TS count > WASM count ===`);
  for (const [k, tc] of tsCellCounts.entries()) {
    const wc = wasmCellCounts.get(k) ?? 0;
    if (tc > wc) console.log(`  ${k}: TS=${tc} WASM=${wc}`);
  }

  await wasmCtx.close();
  await tsCtx.close();
});
