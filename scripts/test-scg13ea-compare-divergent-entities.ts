/**
 * Deep compare state of the 5 entities that diverge in RNG count at SCG13EA tick 43.
 * Pair WASM Logic pos 173/182/186/191/192 with TS logicIdx 128/137/141/146/147.
 * Compare their full state (cell, type, house, mission, timer, doing, idle, firing, prone)
 * to determine if divergence is gate-behavior (same state) or iteration-order (different entities).
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA compare divergent entity states at tick 42 end', async ({ browser }) => {
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

  for (let t = 0; t < 42; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  // WASM: get full logicLayer + infantry state from enemy/unit arrays
  const wasmData = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    const allInf = [...(s.units ?? []), ...(s.enemies ?? [])]
      .filter((u: { t: string }) => {
        const types = ['E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'DOG', 'MEDI', 'THF', 'SPY', 'CHAN', 'SNIPE'];
        return types.includes(u.t);
      });
    return {
      logicLayer: s.logicLayer ?? [],
      infantry: allInf.map((u: { id: number; t: string; house: string; cx: number; cy: number; m: number; mt: number; arm: number; doing?: number; idle?: number; firing?: boolean; prone?: boolean }) => u),
    };
  });

  // TS: dump entity state indexed by logicIdx
  const tsData = await tsPage.evaluate(() => {
    const game = (window as any).__agentGame;
    if (!game) return null;
    return game.entities.map((e: { id: number; type: string; house: string; cell: { cx: number; cy: number }; mission: string; missionTimer: number; alive: boolean; inLimbo: boolean; attackCooldown: number; doing: string; idleAnimTimer: number; isFiringAnim: boolean; isProne: boolean; isDriving: boolean; stats: { isInfantry: boolean } }, i: number) => ({
      logicIdx: i, id: e.id, type: e.type, house: e.house,
      cx: e.cell.cx, cy: e.cell.cy,
      mission: e.mission, mt: e.missionTimer,
      alive: e.alive, inLimbo: e.inLimbo, arm: e.attackCooldown,
      doing: e.doing, idle: e.idleAnimTimer, firing: e.isFiringAnim,
      prone: e.isProne, driving: e.isDriving, isInf: e.stats.isInfantry,
      tgt: (e as unknown as { target?: { id: number; type: string; cell?: { cx: number; cy: number } } }).target
        ? `${(e as unknown as { target: { type: string; cell?: { cx: number; cy: number } } }).target.type}@${(e as unknown as { target: { cell?: { cx: number; cy: number } } }).target.cell?.cx},${(e as unknown as { target: { cell?: { cx: number; cy: number } } }).target.cell?.cy}`
        : null,
      tgtStruct: (e as unknown as { targetStructure?: { type: string; cx: number; cy: number } }).targetStructure
        ? `${(e as unknown as { targetStructure: { type: string; cx: number; cy: number } }).targetStructure.type}@${(e as unknown as { targetStructure: { cx: number; cy: number } }).targetStructure.cx},${(e as unknown as { targetStructure: { cx: number; cy: number } }).targetStructure.cy}`
        : null,
    }));
  });

  // Find WASM infantry at Logic positions 173, 182, 186, 191, 192.
  // logicLayer is array of [logicPos, tname, hname, cx, cy] (see serialize).
  const logicLayer = wasmData.logicLayer as Array<[number, string, string, number, number]>;
  console.log('=== WASM Logic positions 170-195 ===');
  for (const entry of logicLayer) {
    const [pos, tname, hname, cx, cy] = entry;
    if (pos >= 170 && pos <= 195) {
      // Find infantry with matching cell
      const inf = wasmData.infantry.find((i: { cx: number; cy: number; t: string; house: string }) =>
        i.cx === cx && i.cy === cy && i.t === tname && i.house === hname);
      if (inf) {
        console.log(`  pos=${pos} t=${tname} house=${hname} (${cx},${cy}) m=${inf.m} mt=${inf.mt} arm=${inf.arm} doing=${inf.doing} idle=${inf.idle} firing=${inf.firing} prone=${inf.prone}`);
      } else {
        console.log(`  pos=${pos} t=${tname} house=${hname} (${cx},${cy}) [no infantry match]`);
      }
    }
  }

  console.log('\n=== TS entities at logicIdx 125-150 ===');
  for (const e of tsData ?? []) {
    if (e.logicIdx >= 125 && e.logicIdx <= 150) {
      console.log(`  idx=${e.logicIdx} t=${e.type} house=${e.house} (${e.cx},${e.cy}) m=${e.mission} mt=${e.mt} arm=${e.arm} doing=${e.doing} idle=${e.idle} firing=${e.firing} prone=${e.prone} driving=${e.driving} tgt=${e.tgt} struct=${e.tgtStruct}`);
    }
  }

  await wasmCtx.close();
  await tsCtx.close();
});
