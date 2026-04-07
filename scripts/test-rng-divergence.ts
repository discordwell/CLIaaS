import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

// Test the scenarios that have gameplay cascade issues
// SCG02EA: perfect through 500, diverges by 2000
// SCG07EA: diverges by tick 500

const SCENARIO = process.env.SCENARIO || 'SCG02EA';

test(`${SCENARIO}: RNG + state divergence trace`, async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(BASE_URL + '/ra/original.html?scenario=' + SCENARIO + '.INI&autoplay=1&agentharness=1&seed=0', { waitUntil: 'load' }),
    tsPage.goto(BASE_URL + '?anttest=agent&scenario=' + SCENARIO + '&difficulty=normal', { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wasmPage.waitForFunction(() => { try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; } }, { timeout: 120000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120000 }),
  ]);
  const seed = await wasmPage.evaluate(() => { const M = (window as any).Module; return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState; });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, seed);

  // Track RNG calls + unit counts tick by tick
  let prevWU = 0, prevTU = 0, prevWE = 0, prevTE = 0;
  let prevWRng = 0, prevTRng = 0;
  let firstDivergeTick = -1;

  for (let t = 1; t <= 2000; t++) {
    await Promise.all([
      (async () => { try { await wasmPage.evaluate(async (n: number) => { const r = (window as any).__agentStep(n); if (r?.then) await r; }, 1); } catch {} })(),
      tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, 1),
    ]);

    // Check every 15 ticks (processTriggers boundary) or every tick near divergence
    const nearDiv = firstDivergeTick > 0 && t >= firstDivergeTick - 5 && t <= firstDivergeTick + 30;
    if (t % 15 !== 0 && !nearDiv && t > 5) continue;

    const [w, ts] = await Promise.all([
      wasmPage.evaluate(() => {
        const M = (window as any).Module;
        const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
        return {
          tick: s.tick, rng: s.rngState, rngCalls: s.rngCalls,
          units: s.units?.length ?? 0, enemies: s.enemies?.length ?? 0,
          mt: s.missionTimer ?? 0,
          unitTypes: (s.units || []).reduce((a: any, u: any) => { a[u.type || u.t] = (a[u.type || u.t] || 0) + 1; return a; }, {}),
          enemyTypes: (s.enemies || []).reduce((a: any, u: any) => { a[u.type || u.t] = (a[u.type || u.t] || 0) + 1; return a; }, {}),
        };
      }),
      tsPage.evaluate(() => {
        const s = (window as any).__agentState();
        return {
          tick: s.tick, rng: s.rngState, rngCalls: s.rngCalls,
          units: s.units?.length ?? 0, enemies: s.enemies?.length ?? 0,
          mt: s.missionTimer ?? 0,
          unitTypes: (s.units || []).reduce((a: any, u: any) => { a[u.type || u.t] = (a[u.type || u.t] || 0) + 1; return a; }, {}),
          enemyTypes: (s.enemies || []).reduce((a: any, u: any) => { a[u.type || u.t] = (a[u.type || u.t] || 0) + 1; return a; }, {}),
        };
      }),
    ]);

    const rngMatch = w.rng === ts.rng;
    const rngCallDiff = (ts.rngCalls ?? 0) - (w.rngCalls ?? 0);
    const uDiff = w.units - ts.units;
    const eDiff = w.enemies - ts.enemies;

    // Log when RNG diverges or unit counts change
    const rngChanged = rngMatch !== (prevWRng === 0 || w.rng === ts.rng);
    const unitsChanged = uDiff !== (prevWU - prevTU) || eDiff !== (prevWE - prevTE);

    if (!rngMatch && firstDivergeTick < 0) {
      firstDivergeTick = t;
      console.log('\n=== FIRST RNG DIVERGENCE at tick ' + t + ' ===');
      console.log('  WASM rng=' + w.rng + ' calls=' + w.rngCalls);
      console.log('  TS   rng=' + ts.rng + ' calls=' + ts.rngCalls);
      console.log('  Call diff: ' + rngCallDiff);
    }

    if (t <= 5 || unitsChanged || (nearDiv && t % 1 === 0) || t % 150 === 0) {
      let line = 't' + t + ': rng ' + (rngMatch ? 'MATCH' : 'DIFF(' + rngCallDiff + ')');
      line += ' | units W=' + w.units + ' T=' + ts.units;
      line += ' | enemies W=' + w.enemies + ' T=' + ts.enemies;
      if (uDiff !== 0) {
        // Show which types differ
        const allTypes = new Set([...Object.keys(w.unitTypes), ...Object.keys(ts.unitTypes)]);
        const diffs = [...allTypes].filter(t => (w.unitTypes[t] || 0) !== (ts.unitTypes[t] || 0))
          .map(t => t + ':W' + (w.unitTypes[t]||0) + '/T' + (ts.unitTypes[t]||0));
        if (diffs.length) line += ' [' + diffs.join(', ') + ']';
      }
      if (eDiff !== 0) {
        const allTypes = new Set([...Object.keys(w.enemyTypes), ...Object.keys(ts.enemyTypes)]);
        const diffs = [...allTypes].filter(t => (w.enemyTypes[t] || 0) !== (ts.enemyTypes[t] || 0))
          .map(t => t + ':W' + (w.enemyTypes[t]||0) + '/T' + (ts.enemyTypes[t]||0));
        if (diffs.length) line += ' {' + diffs.join(', ') + '}';
      }
      console.log(line);
    }

    prevWU = w.units; prevTU = ts.units; prevWE = w.enemies; prevTE = ts.enemies;
    prevWRng = w.rng;
  }

  await wasmCtx.close();
  await tsCtx.close();
});
