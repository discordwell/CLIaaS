/**
 * Multi-tick divergence finder — steps through ticks and reports unit counts
 * at each checkpoint to identify when divergence first appears.
 *
 * Usage: SCENARIO=SCG09EA TICKS=50,100,200,500,1000,2000 npx playwright test scripts/test-divergence-multi.ts
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';
const scenario = process.env.SCENARIO ?? 'SCG09EA';
const ticks = (process.env.TICKS ?? '50,100,200,500,1000,2000').split(',').map(Number);

test(`${scenario} multi-tick divergence`, async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);

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

  // Sync RNG
  const wasmSeed = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;
  });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  console.log(`\n=== ${scenario} ===\n`);
  console.log(`tick     | ws_u  ts_u  Δu | ws_e  ts_e  Δe | ws_s  ts_s  Δs | ws_c   ts_c   Δc | seed_match`);
  console.log(`---------|----------------|----------------|----------------|------------------|----------`);

  let prevTick = 0;
  for (const targetTick of ticks) {
    const step = targetTick - prevTick;
    if (step > 0) {
      let rem = step;
      while (rem > 0) {
        const batch = Math.min(rem, 300);
        rem -= batch;
        await Promise.all([
          wasmPage.evaluate(async (n: number) => {
            const r = (window as any).__agentStep(n);
            if (r?.then) await r;
          }, batch),
          tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, batch),
        ]);
      }
    }
    prevTick = targetTick;

    const [wasmState, tsState] = await Promise.all([
      wasmPage.evaluate(() => {
        const M = (window as any).Module;
        const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
        const lst = (s.units ?? []).find((u: any) => (u.t ?? u.type) === 'LST');
        return {
          tick: s.tick, credits: s.credits, missionTimer: s.missionTimer ?? 0,
          unitCount: s.units?.length ?? 0, enemyCount: s.enemies?.length ?? 0,
          structCount: s.structures?.length ?? 0, rngSeed: s.rngState,
          lst: lst ? `${lst.cx ?? lst.x},${lst.cy ?? lst.y} m=${lst.m ?? lst.mission}` : 'none',
        };
      }),
      tsPage.evaluate(() => {
        const s = (window as any).__agentState();
        const lst = (s.units ?? []).find((u: any) => (u.t ?? u.type) === 'LST');
        return {
          tick: s.tick, credits: s.credits, missionTimer: s.missionTimer ?? 0,
          unitCount: s.units?.length ?? 0, enemyCount: s.enemies?.length ?? 0,
          structCount: s.structures?.length ?? 0, rngSeed: s.rngState,
          lst: lst ? `${lst.cx ?? lst.x},${lst.cy ?? lst.y} m=${lst.m ?? lst.mission}` : 'none',
        };
      }),
    ]);

    const du = tsState.unitCount - wasmState.unitCount;
    const de = tsState.enemyCount - wasmState.enemyCount;
    const ds = tsState.structCount - wasmState.structCount;
    const dc = tsState.credits - wasmState.credits;
    const seedMatch = (wasmState.rngSeed >>> 0) === (tsState.rngSeed >>> 0) ? '✓' : '✗';
    const fmt = (n: number) => String(n).padStart(5);
    const fmtD = (n: number) => (n === 0 ? '   ' : (n > 0 ? '+' : '')) + String(n).padStart(2);
    console.log(`t=${String(targetTick).padStart(5)} | ${fmt(wasmState.unitCount)} ${fmt(tsState.unitCount)} ${fmtD(du)} | ${fmt(wasmState.enemyCount)} ${fmt(tsState.enemyCount)} ${fmtD(de)} | ${fmt(wasmState.structCount)} ${fmt(tsState.structCount)} ${fmtD(ds)} | ${fmt(wasmState.credits)} ${fmt(tsState.credits)} ${fmtD(dc).padStart(4)} | ${seedMatch} | LST W=${wasmState.lst} T=${tsState.lst}`);
  }

  await wasmCtx.close();
  await tsCtx.close();
});
