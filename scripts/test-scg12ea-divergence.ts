import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

/**
 * SCG12EA unit divergence tracer.
 * Steps both WASM (C++) and TS engines, logging checkpoints where
 * unit or enemy counts differ. Identifies type, position, HP divergences.
 */
test('SCG12EA: unit count divergence trace', async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(BASE_URL + '/ra/original.html?scenario=SCG12EA.INI&autoplay=1&agentharness=1&seed=0', { waitUntil: 'load' }),
    tsPage.goto(BASE_URL + '?anttest=agent&scenario=SCG12EA&difficulty=normal', { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wasmPage.waitForFunction(() => { try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length >= 0; } catch { return false; } }, { timeout: 120000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120000 }),
  ]);
  const seed = await wasmPage.evaluate(() => { const M = (window as any).Module; return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState; });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, seed);

  // Type counter helper
  const typeCount = (arr: any[]) => {
    const m: Record<string, number> = {};
    for (const u of arr) m[u.type] = (m[u.type] || 0) + 1;
    return Object.entries(m).sort().map(([t,c]) => t + ':' + c).join(' ');
  };

  // Full state snapshot
  const getState = async (label: string) => {
    const [w, t] = await Promise.all([
      wasmPage.evaluate(() => {
        const M = (window as any).Module;
        const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
        const mapU = (arr: any[]) => (arr || []).map((u: any) => ({
          id: u.id, type: u.type || u.t, hp: u.hp, maxHp: u.mhp,
          x: u.cx, y: u.cy, mission: u.mission || u.m, house: u.house || u.h
        }));
        return { tick: s.tick, units: mapU(s.units), enemies: mapU(s.enemies), credits: s.credits,
          rngState: s.rngState, rngCalls: s.rngCalls, unitsLeftMap: s.unitsLeftMap,
          civiliansEvacuated: s.civiliansEvacuated, missionTimer: s.missionTimer };
      }),
      tsPage.evaluate(() => {
        const s = (window as any).__agentState();
        const mapU = (arr: any[]) => (arr || []).map((u: any) => ({
          id: u.id, type: u.type || u.t, hp: u.hp, maxHp: u.mhp,
          x: u.cx, y: u.cy, mission: u.mission || u.m, house: u.house || u.h
        }));
        return { tick: s.tick, units: mapU(s.units), enemies: mapU(s.enemies), credits: s.credits,
          rngState: s.rngState, rngCalls: s.rngCalls, unitsLeftMap: s.unitsLeftMap,
          civiliansEvacuated: s.civiliansEvacuated, missionTimer: s.missionTimer };
      }),
    ]);
    return { w, t, label };
  };

  // Step both engines by N ticks
  const step = async (n: number) => {
    await Promise.all([
      wasmPage.evaluate(async (ticks: number) => {
        const fn = (window as any).__agentStep;
        if (!fn) return;
        // Step in chunks of 10 to avoid blocking
        let rem = ticks;
        while (rem > 0) {
          const c = Math.min(rem, 10);
          rem -= c;
          const r = fn(c);
          if (r?.then) await r;
        }
      }, n),
      tsPage.evaluate((ticks: number) => { (window as any).__agentStep?.(ticks); }, n),
    ]);
  };

  const logState = (s: { w: any, t: any, label: string }) => {
    const ud = s.w.units.length - s.t.units.length;
    const ed = s.w.enemies.length - s.t.enemies.length;
    console.log('\n=== ' + s.label + ' ===');
    console.log('W: tick=' + s.w.tick + ' units=' + s.w.units.length + ' enemies=' + s.w.enemies.length + ' credits=' + s.w.credits + ' rng=' + s.w.rngCalls + ' leftMap=' + s.w.unitsLeftMap + ' civEvac=' + s.w.civiliansEvacuated);
    console.log('T: tick=' + s.t.tick + ' units=' + s.t.units.length + ' enemies=' + s.t.enemies.length + ' credits=' + s.t.credits + ' rng=' + s.t.rngCalls + ' leftMap=' + s.t.unitsLeftMap + ' civEvac=' + s.t.civiliansEvacuated);
    console.log('Delta: units=' + ud + ' enemies=' + ed + ' total=' + (ud+ed));
    if (ud !== 0 || ed !== 0) {
      console.log('W units: ' + typeCount(s.w.units));
      console.log('T units: ' + typeCount(s.t.units));
      console.log('W enemies: ' + typeCount(s.w.enemies));
      console.log('T enemies: ' + typeCount(s.t.enemies));
    }
  };

  // === TICK 0 ===
  let s0 = await getState('TICK 0');
  logState(s0);

  // === Step 1 tick at a time for ticks 1-5 (catch immediate setup) ===
  for (let i = 1; i <= 5; i++) {
    await step(1);
    const s = await getState('TICK ' + i);
    logState(s);
  }

  // === Then larger batches: 5->50, 50->100, 100->200, 200->500, ... ===
  const batchTargets = [10, 20, 50, 100, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 5000, 7000, 10000];
  let currentTick = 5;
  for (const target of batchTargets) {
    const skip = target - currentTick;
    if (skip <= 0) continue;
    await step(skip);
    currentTick = target;
    const s = await getState('TICK ' + target);
    logState(s);

    // If there's a divergence, drill down with HP comparisons
    if (s.w.units.length !== s.t.units.length || s.w.enemies.length !== s.t.enemies.length) {
      // Identify missing/extra types
      const wUnitTypes: Record<string, number> = {};
      const tUnitTypes: Record<string, number> = {};
      for (const u of s.w.units) wUnitTypes[u.type] = (wUnitTypes[u.type] || 0) + 1;
      for (const u of s.t.units) tUnitTypes[u.type] = (tUnitTypes[u.type] || 0) + 1;
      const allTypes = new Set([...Object.keys(wUnitTypes), ...Object.keys(tUnitTypes)]);
      for (const t of allTypes) {
        const wc = wUnitTypes[t] || 0;
        const tc = tUnitTypes[t] || 0;
        if (wc !== tc) console.log('  Unit diff: ' + t + ' W=' + wc + ' T=' + tc + ' (' + (wc-tc>0?'+':'') + (wc-tc) + ')');
      }

      const wETypes: Record<string, number> = {};
      const tETypes: Record<string, number> = {};
      for (const u of s.w.enemies) wETypes[u.type] = (wETypes[u.type] || 0) + 1;
      for (const u of s.t.enemies) tETypes[u.type] = (tETypes[u.type] || 0) + 1;
      const allETypes = new Set([...Object.keys(wETypes), ...Object.keys(tETypes)]);
      for (const t of allETypes) {
        const wc = wETypes[t] || 0;
        const tc = tETypes[t] || 0;
        if (wc !== tc) console.log('  Enemy diff: ' + t + ' W=' + wc + ' T=' + tc + ' (' + (wc-tc>0?'+':'') + (wc-tc) + ')');
      }

      // Check for HP divergences on matching units
      let hpDiffs = 0;
      for (const wu of s.w.enemies) {
        const match = s.t.enemies.find((te: any) => te.id === wu.id);
        if (match && wu.hp !== match.hp && hpDiffs < 10) {
          console.log('  HP diff enemy id=' + wu.id + ' ' + wu.type + ': W.hp=' + wu.hp + ' T.hp=' + match.hp + ' @W(' + wu.x + ',' + wu.y + ') T(' + match.x + ',' + match.y + ')');
          hpDiffs++;
        }
      }
      for (const wu of s.w.units) {
        const match = s.t.units.find((tu: any) => tu.id === wu.id);
        if (match && wu.hp !== match.hp && hpDiffs < 10) {
          console.log('  HP diff unit id=' + wu.id + ' ' + wu.type + ': W.hp=' + wu.hp + ' T.hp=' + match.hp + ' @W(' + wu.x + ',' + wu.y + ') T(' + match.x + ',' + match.y + ')');
          hpDiffs++;
        }
      }
    }
  }

  // === FINAL: Binary search for first divergence tick ===
  // If tick 1 already diverged, report it. Otherwise find the first divergence.
  console.log('\n=== DIVERGENCE TRACE COMPLETE ===');

  await wasmCtx.close();
  await tsCtx.close();
});
