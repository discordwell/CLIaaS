/**
 * Per-entity RNG diff — tick-by-tick comparison of WASM vs TS RNG call logs.
 *
 * Both engines already have per-entity source tagging:
 *   WASM: g_rng_source_tag in logic.cpp → rngLog in agent_get_state
 *   TS:   ScenarioRandom._sourceTag → _seedLog via __rngTagControl
 *
 * Tag scheme (matching logic.cpp:288-296):
 *   10000 + logicIdx  = infantry
 *   11000 + logicIdx  = units (vehicles)
 *   12000 + logicIdx  = buildings
 *   13000 + logicIdx  = aircraft
 *   14000 + logicIdx  = vessels
 *   15000 + logicIdx  = bullets
 *   16000 + logicIdx  = anims
 *   1 = Team AI, 3 = Map.Logic, 4 = Factory AI, 5 = House AI preamble
 *   20 = Do_Fade_AI, 21 = LogicTrigger
 *
 * Usage:
 *   SCENARIO=SCG08EA START=89 END=100 npx playwright test scripts/test-rng-entity-diff.ts
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';
const scenario = process.env.SCENARIO ?? 'SCG08EA';
const startTick = Number(process.env.START ?? 89);
const endTick = Number(process.env.END ?? 100);

function tagName(tag: number): string {
  if (tag >= 16000) return `anim[${tag - 16000}]`;
  if (tag >= 15000) return `bullet[${tag - 15000}]`;
  if (tag >= 14000) return `vessel[${tag - 14000}]`;
  if (tag >= 13000) return `aircraft[${tag - 13000}]`;
  if (tag >= 12000) return `building[${tag - 12000}]`;
  if (tag >= 11000) return `unit[${tag - 11000}]`;
  if (tag >= 10000) return `infantry[${tag - 10000}]`;
  if (tag >= 200) return `Expert_AI`;
  if (tag >= 100 && tag < 200) return `House_AI[${tag}]`;
  const names: Record<number, string> = {
    0: 'untagged', 1: 'TeamAI', 3: 'Map.Logic', 4: 'FactoryAI',
    5: 'House_AI_preamble', 20: 'Do_Fade_AI', 21: 'LogicTrigger',
  };
  return names[tag] ?? `tag[${tag}]`;
}

test(`${scenario} per-entity RNG diff ticks ${startTick}-${endTick}`, async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);

  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  console.log(`\n=== ${scenario} per-entity RNG diff: ticks ${startTick}→${endTick} ===\n`);

  // Launch both engines
  await Promise.all([
    wasmPage.goto(
      `${BASE_URL}/ra/original.html?scenario=${scenario}.INI&autoplay=1&agentharness=1&seed=0`,
      { waitUntil: 'load' },
    ),
    tsPage.goto(
      `${BASE_URL}?anttest=agent&scenario=${scenario}&difficulty=normal`,
      { waitUntil: 'load' },
    ),
  ]);

  // Wait for both to be ready
  await Promise.all([
    wasmPage.waitForFunction(() => {
      try {
        const M = (window as any).Module;
        return M?.ccall && JSON.parse(M.ccall('agent_get_state', 'string', [], [])).units?.length > 0;
      } catch { return false; }
    }, { timeout: 180_000, polling: 2000 }),
    tsPage.waitForFunction(
      () => (window as any).__agentReady === true,
      { timeout: 120_000, polling: 1000 },
    ),
  ]);

  // Sync RNG seed from WASM to TS
  const wasmSeed = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    return JSON.parse(M.ccall('agent_get_state', 'string', [], [])).rngState;
  });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);
  console.log(`Synced seed: ${wasmSeed}\n`);

  // Enable TS tag logging
  await tsPage.evaluate(() => { (window as any).__rngTagControl('enable'); });

  // Step both to startTick in bulk (reading WASM state resets its log each time)
  if (startTick > 1) {
    const bulkStep = startTick - 1;
    let rem = bulkStep;
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
    // Read WASM state to reset its log, read+reset TS log
    await Promise.all([
      wasmPage.evaluate(() => {
        const M = (window as any).Module;
        JSON.parse(M.ccall('agent_get_state', 'string', [], []));
      }),
      tsPage.evaluate(() => {
        (window as any).__rngTagControl('reset');
      }),
    ]);
    console.log(`Bulk-stepped to tick ${startTick}. Starting per-tick diff...\n`);
  }

  // Read seeds before tick-by-tick stepping (WASM agent_get_state resets rng log — fine here)
  const [wasmPreSeed, tsPreSeed] = await Promise.all([
    wasmPage.evaluate(() => {
      const M = (window as any).Module;
      return JSON.parse(M.ccall('agent_get_state', 'string', [], [])).rngState as number;
    }),
    tsPage.evaluate(() => {
      (window as any).__rngTagControl('reset');
      return (window as any).__rngTagControl('read').seed as number;
    }),
  ]);
  console.log(`Pre-loop seeds — WASM: ${wasmPreSeed >>> 0}, TS: ${tsPreSeed >>> 0}, match: ${(wasmPreSeed >>> 0) === (tsPreSeed >>> 0)}\n`);

  // Tick-by-tick diff
  let totalDivergences = 0;
  for (let tick = startTick; tick <= endTick; tick++) {
    // Reset TS log before stepping
    await tsPage.evaluate(() => { (window as any).__rngTagControl('reset'); });

    // Step both engines 1 tick — capture rngLog from step return (not separate agent_get_state)
    const [wasmStepResult, _] = await Promise.all([
      wasmPage.evaluate(async () => {
        const r = (window as any).__agentStep(1);
        const result = r?.then ? await r : r;
        // rngLog is inside .state (agent_step returns {results: ..., state: ...})
        const s = result?.state ?? result;
        return {
          tick: s.tick as number,
          seed: s.rngState as number,
          calls: s.rngCalls as number,
          log: (s.rngLog ?? []) as [number, number][],
          logicLayer: (s.logicLayer ?? []) as [number, string, string][],
        };
      }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);

    // Read TS RNG log
    const wasmData = wasmStepResult;
    const tsData = await tsPage.evaluate(() => {
      const r = (window as any).__rngTagControl('read');
      const s = (window as any).__agentState();
      return {
        tick: s.tick as number,
        seed: r.seed as number,
        calls: r.callCount as number,
        log: (r.seedLog ?? []) as [number, number][],
      };
    });

    const seedMatch = (wasmData.seed >>> 0) === (tsData.seed >>> 0);
    const callDiff = wasmData.log.length - tsData.log.length;

    // Check for tracked building calls (building[139] in WASM = building[39] in TS)
    const TRACK_WASM = [139, 146]; // WASM Logic indices to track
    const TRACK_TS = [39, 46]; // TS logicIdx equivalents
    const wasmTracked = wasmData.log.filter(([_, tag]) => TRACK_WASM.some(t => tag === 12000 + t));
    const tsTracked = tsData.log.filter(([_, tag]) => TRACK_TS.some(t => tag === 12000 + t));
    const trackInfo = wasmTracked.length > 0 || tsTracked.length > 0
      ? ` | tracked: W=${wasmTracked.map(e => tagName(e[1])).join(',')||'—'} T=${tsTracked.map(e => tagName(e[1])).join(',')||'—'}`
      : '';

    // Always print tick header
    const marker = seedMatch && callDiff === 0 ? '✓' : '✗';
    console.log(
      `tick ${tick}: ${marker}  WASM(${wasmData.log.length} calls, seed=${wasmData.seed >>> 0})  TS(${tsData.log.length} calls, seed=${tsData.seed >>> 0})  Δcalls=${callDiff}${trackInfo}`,
    );

    if (!seedMatch || callDiff !== 0) {
      totalDivergences++;

      // Print side-by-side log comparison
      const maxLen = Math.max(wasmData.log.length, tsData.log.length);
      for (let i = 0; i < maxLen; i++) {
        const wEntry = wasmData.log[i];
        const tEntry = tsData.log[i];
        const wStr = wEntry ? `[${tagName(wEntry[1]).padEnd(18)} seed=${(wEntry[0] >>> 0)}]` : '(none)'.padEnd(35);
        const tStr = tEntry ? `[${tagName(tEntry[1]).padEnd(18)} seed=${(tEntry[0] >>> 0)}]` : '(none)'.padEnd(35);

        const match = wEntry && tEntry && (wEntry[0] >>> 0) === (tEntry[0] >>> 0) && wEntry[1] === tEntry[1];
        const seedSame = wEntry && tEntry && (wEntry[0] >>> 0) === (tEntry[0] >>> 0);
        const tagSame = wEntry && tEntry && wEntry[1] === tEntry[1];
        let flag = '';
        if (!match) {
          if (!wEntry) flag = ' << WASM missing';
          else if (!tEntry) flag = ' << TS missing';
          else if (!tagSame) flag = ' << TAG MISMATCH';
          else if (!seedSame) flag = ' << SEED MISMATCH';
        }
        console.log(`  [${String(i).padStart(3)}] WASM: ${wStr}  TS: ${tStr}${flag}`);
      }
      console.log('');
    }

    // Also dump entity info at divergent ticks for context
    if (!seedMatch || callDiff !== 0) {
      console.log(`  WASM Logic layer (${wasmData.logicLayer.length} entities):`);
      for (const [idx, type, house] of wasmData.logicLayer.slice(0, 40)) {
        console.log(`    [${idx}] ${type} (${house})`);
      }
      console.log('');
    }
  }

  console.log(`\n=== Summary: ${totalDivergences} divergent ticks out of ${endTick - startTick + 1} ===\n`);

  await wasmCtx.close();
  await tsCtx.close();
});
