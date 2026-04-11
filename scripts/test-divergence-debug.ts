/**
 * Divergence debugger — dumps detailed unit breakdown at specific ticks
 * Usage: SCENARIO=SCG07EA TICK=4 npx playwright test scripts/test-divergence-debug.ts
 */
import { test } from '@playwright/test';
import * as fs from 'fs';

const BASE_URL = 'https://cliaas.com';
const scenario = process.env.SCENARIO ?? 'SCG07EA';
const targetTick = Number(process.env.TICK ?? 4);

test(`${scenario} divergence debug at tick ${targetTick}`, async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);

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

  // Step to target tick
  let rem = targetTick;
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

  // Get detailed state from both
  const [wasmDetail, tsDetail] = await Promise.all([
    wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      // Count by type
      const unitsByType: Record<string, number> = {};
      for (const u of (s.units ?? [])) {
        const t = u.t ?? u.type ?? '?';
        unitsByType[t] = (unitsByType[t] || 0) + 1;
      }
      const enemiesByType: Record<string, number> = {};
      for (const e of (s.enemies ?? [])) {
        const t = e.t ?? e.type ?? '?';
        enemiesByType[t] = (enemiesByType[t] || 0) + 1;
      }
      return {
        tick: s.tick,
        rngState: s.rngState,
        rngCalls: s.rngCalls,
        units: s.units?.length ?? 0,
        enemies: s.enemies?.length ?? 0,
        structures: s.structures?.length ?? 0,
        credits: s.credits,
        missionTimer: s.missionTimer ?? 0,
        unitsByType,
        enemiesByType,
        // First 10 units with positions
        unitList: (s.units ?? []).slice(0, 30).map((u: any) => `${u.t ?? u.type}@${u.cx ?? u.x},${u.cy ?? u.y} hp=${u.hp} m=${u.m ?? u.mission} h=${u.h ?? u.house}`),
        enemyList: (s.enemies ?? []).slice(0, 30).map((e: any) => `${e.t ?? e.type}@${e.cx ?? e.x},${e.cy ?? e.y} hp=${e.hp} m=${e.m ?? e.mission} h=${e.h ?? e.house}`),
      };
    }),
    tsPage.evaluate(() => {
      const s = (window as any).__agentState();
      const unitsByType: Record<string, number> = {};
      for (const u of (s.units ?? [])) {
        const t = u.t ?? u.type ?? '?';
        unitsByType[t] = (unitsByType[t] || 0) + 1;
      }
      const enemiesByType: Record<string, number> = {};
      for (const e of (s.enemies ?? [])) {
        const t = e.t ?? e.type ?? '?';
        enemiesByType[t] = (enemiesByType[t] || 0) + 1;
      }
      return {
        tick: s.tick,
        rngState: s.rngState,
        rngCalls: s.rngCalls,
        units: s.units?.length ?? 0,
        enemies: s.enemies?.length ?? 0,
        structures: s.structures?.length ?? 0,
        credits: s.credits,
        missionTimer: s.missionTimer ?? 0,
        unitsByType,
        enemiesByType,
        unitList: (s.units ?? []).slice(0, 30).map((u: any) => `${u.t ?? u.type}@${u.cx ?? u.x},${u.cy ?? u.y} hp=${u.hp} m=${u.m ?? u.mission} h=${u.h ?? u.house}`),
        enemyList: (s.enemies ?? []).slice(0, 30).map((e: any) => `${e.t ?? e.type}@${e.cx ?? e.x},${e.cy ?? e.y} hp=${e.hp} m=${e.m ?? e.mission} h=${e.h ?? e.house}`),
      };
    }),
  ]);

  console.log(`\n=== ${scenario} @ tick ${targetTick} ===`);
  console.log(`\nWASM: tick=${wasmDetail.tick} rng=${wasmDetail.rngState} calls=${wasmDetail.rngCalls}`);
  console.log(`  units=${wasmDetail.units} enemies=${wasmDetail.enemies} structs=${wasmDetail.structures} credits=${wasmDetail.credits} timer=${wasmDetail.missionTimer}`);
  console.log(`  unitsByType:`, JSON.stringify(wasmDetail.unitsByType));
  console.log(`  enemiesByType:`, JSON.stringify(wasmDetail.enemiesByType));

  console.log(`\nTS:   tick=${tsDetail.tick} rng=${tsDetail.rngState} calls=${tsDetail.rngCalls}`);
  console.log(`  units=${tsDetail.units} enemies=${tsDetail.enemies} structs=${tsDetail.structures} credits=${tsDetail.credits} timer=${tsDetail.missionTimer}`);
  console.log(`  unitsByType:`, JSON.stringify(tsDetail.unitsByType));
  console.log(`  enemiesByType:`, JSON.stringify(tsDetail.enemiesByType));

  // Find type differences
  const allTypes = new Set([...Object.keys(wasmDetail.unitsByType), ...Object.keys(tsDetail.unitsByType),
    ...Object.keys(wasmDetail.enemiesByType), ...Object.keys(tsDetail.enemiesByType)]);
  console.log('\n--- Type differences ---');
  for (const t of allTypes) {
    const wu = wasmDetail.unitsByType[t] ?? 0;
    const tu = tsDetail.unitsByType[t] ?? 0;
    const we = wasmDetail.enemiesByType[t] ?? 0;
    const te = tsDetail.enemiesByType[t] ?? 0;
    if (wu !== tu) console.log(`  UNIT ${t}: WASM=${wu} TS=${tu} (±${Math.abs(wu-tu)})`);
    if (we !== te) console.log(`  ENEMY ${t}: WASM=${we} TS=${te} (±${Math.abs(we-te)})`);
  }

  // Dump unit lists for manual inspection
  console.log('\n--- WASM units ---');
  for (const u of wasmDetail.unitList) console.log(`  ${u}`);
  console.log('\n--- TS units ---');
  for (const u of tsDetail.unitList) console.log(`  ${u}`);
  console.log('\n--- WASM enemies ---');
  for (const e of wasmDetail.enemyList) console.log(`  ${e}`);
  console.log('\n--- TS enemies ---');
  for (const e of tsDetail.enemyList) console.log(`  ${e}`);

  // Save to file
  fs.writeFileSync('/tmp/divergence-debug.json', JSON.stringify({ wasm: wasmDetail, ts: tsDetail }, null, 2));
  console.log('\nFull state saved to /tmp/divergence-debug.json');

  await wasmCtx.close();
  await tsCtx.close();
});
