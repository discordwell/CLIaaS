/**
 * Phase 3e: SCG04EA unit[2] parallel speed trace — TS vs WASM side-by-side.
 *
 * Runs both engines to tick 28 with unit[2]-narrow instrumentation on both
 * sides (WASM tags 11000000/11100000+Frame, TS __scg04SpeedLog array).
 * Prints TS + WASM entries aligned by tick.
 */
import { test } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG04EA unit[2] parallel speed trace', async ({ browser }) => {
  test.setTimeout(180_000);
  const wCtx = await browser.newContext();
  const tCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wp = await wCtx.newPage();
  const tp = await tCtx.newPage();
  wp.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wp.goto(`${BASE}/ra/original.html?scenario=SCG04EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tp.goto(`${BASE}/?anttest=agent&scenario=SCG04EA&difficulty=normal`, { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wp.waitForFunction(() => { try { const M=(window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; } }, { timeout: 180_000, polling: 2000 }),
    tp.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);
  const wSeed = await wp.evaluate(() => {
    const M = (window as any).Module;
    return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;
  });
  await tp.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wSeed);

  // Enable TS-side trace
  await tp.evaluate(() => { (globalThis as any).__traceSCG04Speed = true; });

  const wState = await wp.evaluate(async () => {
    const r = (window as any).__agentStep(28);
    const res = r?.then ? await r : r;
    return res?.state ?? res;
  });

  const tLog = await tp.evaluate(() => {
    const arr = (globalThis as any).__scg04SpeedLog ?? [];
    return arr;
  });
  await tp.evaluate(() => { (window as any).__agentStep?.(28); });
  const tLog2 = await tp.evaluate(() => {
    const arr = (globalThis as any).__scg04SpeedLog ?? [];
    return arr;
  });

  const wDebug = wState.debugMoves ?? [];

  // Parse WASM entries
  const wByTick: Record<number, { entry?: any; exit?: any }> = {};
  for (const m of wDebug) {
    const [tag, uid, a, b, c, d, e, f] = m;
    if (tag >= 11000000 && tag < 11100000) {
      const frame = tag % 1000;
      wByTick[frame] ??= {};
      wByTick[frame].entry = { speedAccumBefore: a, actual: b, trackIndex: c, trackNumber: d, cx: e, cy: f };
    } else if (tag >= 11100000 && tag < 11200000) {
      const frame = tag % 1000;
      wByTick[frame] ??= {};
      wByTick[frame].exit = { speedAccumAfter: a, trackIndex: b, trackNumber: c, isDriving: d, cx: e, cy: f };
    }
  }

  // Parse TS entries (only after RNG sync = tick 0+; filter to unit id=2 which is the 3TNK)
  const tByTick: Record<number, { entry?: any; exit?: any }> = {};
  for (const r of tLog2) {
    if (!tByTick[r.tick]) tByTick[r.tick] = {};
    if (r.phase === 'ENTRY') tByTick[r.tick].entry = r;
    else tByTick[r.tick].exit = r;
  }

  console.log('\n=== SCG04 unit[2] parallel speed trace ===\n');
  console.log(`WASM entries: ${Object.keys(wByTick).length}, TS entries: ${Object.keys(tByTick).length}\n`);

  const allTicks = new Set<number>([...Object.keys(wByTick).map(Number), ...Object.keys(tByTick).map(Number)]);
  for (const t of [...allTicks].sort((a, b) => a - b)) {
    const w = wByTick[t];
    const ts = tByTick[t];
    console.log(`=== Tick ${t} ===`);
    if (w?.entry) {
      console.log(`  WASM entry: SpeedAccum=${w.entry.speedAccumBefore} actual=${w.entry.actual} trkIdx=${w.entry.trackIndex} trkNum=${w.entry.trackNumber} cell=(${w.entry.cx},${w.entry.cy})`);
    }
    if (ts?.entry) {
      console.log(`  TS   entry: SpeedAccum=${ts.entry.speedAccumBefore} actual=${ts.entry.actual} trkIdx=${ts.entry.trackIndex} trkNum=${ts.entry.trackNumber} cell=(${ts.entry.cx},${ts.entry.cy}) biased=${ts.entry.biasedSpeed?.toFixed(3)} delta=${ts.entry.leptonDelta}`);
    }
    if (w?.exit) {
      console.log(`  WASM exit:  SpeedAccum=${w.exit.speedAccumAfter} trkIdx=${w.exit.trackIndex} trkNum=${w.exit.trackNumber} drv=${w.exit.isDriving} cell=(${w.exit.cx},${w.exit.cy})`);
    }
    if (ts?.exit) {
      console.log(`  TS   exit:  SpeedAccum=${ts.exit.speedAccumAfter} trkIdx=${ts.exit.trackIndex} trkNum=${ts.exit.trackNumber} drv=${ts.exit.isDriving} cell=(${ts.exit.cx},${ts.exit.cy})`);
    }
  }

  await wCtx.close(); await tCtx.close();
});
