/**
 * RNG Divergence Tracer: TS engine vs C++ WASM tick-by-tick.
 *
 * Steps both engines tick-by-tick (1 tick at a time) from tick 1 to tick 100,
 * comparing RNG seeds at each tick. Finds the EXACT first tick where seeds
 * diverge and captures per-tick call counts + source-tag logs for diagnosis.
 *
 * Run: npx playwright test scripts/test-rng-divergence.ts
 */

import { test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// WASM engine always uses cliaas.com (deployed C++ build)
// TS engine uses local dev server so we get latest code changes
const WASM_BASE = process.env.WASM_URL || 'https://cliaas.com';
const TS_BASE = process.env.TS_URL || 'http://localhost:3002';
const OUT_DIR = path.join(process.cwd(), 'test-results', 'rng-divergence');
const SCENARIO = 'SCG02EA';
const MAX_TICK = 100;

// ── Types ──────────────────────────────────────────────────

interface RngTickState {
  tick: number;
  rngState: number;
  rngCalls: number;
  rngLog: Array<[number, number]>; // per-tick [seed, sourceTag] pairs
  unitCount: number;
  enemyCount: number;
  structureCount: number;
  logicLayer?: Array<[number, string, string]>;
}

interface TickComparison {
  tick: number;
  wasmSeed: number;
  tsSeed: number;
  wasmCalls: number;
  tsCalls: number;
  wasmTickDelta: number;
  tsTickDelta: number;
  seedMatch: boolean;
  wasmUnits: number;
  tsUnits: number;
  wasmEnemies: number;
  tsEnemies: number;
}

// ── Helpers ──────────────────────────────────────────────────

function ensureDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function saveJson(data: unknown, filePath: string): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ── WASM single-tick step with RNG log ─────────────────────

async function wasmStepOne(page: Page): Promise<RngTickState> {
  // agent_step(1) internally: runs 1 tick, then calls agent_get_state() which
  // dumps rngLog (accumulated since last agent_get_state) and resets it.
  // So each call gives exactly per-tick data.
  const raw = await page.evaluate(async () => {
    const w = window as any;
    const Module = w.Module;
    if (!Module?.ccall) return { error: 'not ready' };
    if (Module._set_autoplay) Module._set_autoplay(1);

    const str = await Module.ccall(
      'agent_step', 'string',
      ['number', 'string'], [1, ''],
      { async: true },
    );
    const result = JSON.parse(str);
    const state = result.state || result;
    return {
      tick: state.tick,
      rngState: state.rngState,
      rngCalls: state.rngCalls,
      rngLog: state.rngLog || [],
      unitCount: (state.units || []).length,
      enemyCount: (state.enemies || []).length,
      structureCount: (state.structures || []).length,
      logicLayer: state.logicLayer || [],
    };
  });
  return raw as RngTickState;
}

// ── TS single-tick step with per-tick RNG log ──────────────

async function tsStepOne(page: Page): Promise<RngTickState> {
  // Uses __rngTagControl to enable logging, reset log, step, then read log.
  const raw = await page.evaluate(() => {
    const w = window as any;
    if (!w.__agentStep || !w.__rngTagControl) {
      return { error: 'harness not ready' };
    }

    // Enable tag logging and reset the log for this tick
    w.__rngTagControl('enable');
    w.__rngTagControl('reset');

    // Step 1 tick
    const result = w.__agentStep(1);
    const state = result.state;

    // Read the per-tick log, then disable
    const logData = w.__rngTagControl('read');
    w.__rngTagControl('disable');

    return {
      tick: state.tick,
      rngState: state.rngState,
      rngCalls: state.rngCalls,
      rngLog: logData.seedLog || [],
      unitCount: (state.units || []).length,
      enemyCount: (state.enemies || []).length,
      structureCount: (state.structures || []).length,
    };
  });
  return raw as RngTickState;
}

// ── Main test ──────────────────────────────────────────────

test.describe(`RNG Divergence Trace: ${SCENARIO}`, () => {
  test.setTimeout(15 * 60 * 1000);

  test('tick-by-tick RNG comparison', async ({ browser }) => {
    ensureDir();

    const wasmCtx = await browser.newContext({ viewport: { width: 640, height: 400 } });
    const tsCtx = await browser.newContext({ viewport: { width: 640, height: 400 } });
    const wasmPage = await wasmCtx.newPage();
    const tsPage = await tsCtx.newPage();

    const wasmLogs: string[] = [];
    const tsLogs: string[] = [];
    wasmPage.on('console', msg => wasmLogs.push(`[${msg.type()}] ${msg.text()}`));
    tsPage.on('console', msg => tsLogs.push(`[${msg.type()}] ${msg.text()}`));
    wasmPage.on('dialog', async dialog => { await dialog.accept(); });

    // ── Load both engines ──
    console.log(`Loading both engines for ${SCENARIO} with seed=0...`);

    const wasmUrl = `${WASM_BASE}/ra/original.html?scenario=${SCENARIO}.INI&autoplay=1&agentharness=1&seed=0`;
    const tsUrl = `${TS_BASE}?anttest=agent&scenario=${SCENARIO}&difficulty=normal`;

    await Promise.all([
      wasmPage.goto(wasmUrl, { waitUntil: 'load', timeout: 120_000 }),
      tsPage.goto(tsUrl, { waitUntil: 'load', timeout: 120_000 }),
    ]);

    // ── Wait for both engines ──
    console.log('Waiting for engines to initialize...');
    await Promise.all([
      wasmPage.waitForFunction(() => {
        const t = document.title;
        return t.includes('ENTERING_GAME_LOOP') || t.includes('SELECT_GAME_DONE');
      }, { timeout: 180_000, polling: 1000 }),
      tsPage.waitForFunction(
        () => (window as unknown as { __agentReady?: boolean }).__agentReady === true,
        { timeout: 120_000, polling: 1000 },
      ),
    ]);

    // Wait for WASM gameplay state
    await wasmPage.waitForFunction(() => {
      try {
        const Asyncify = (window as unknown as { Asyncify?: { state: number } }).Asyncify;
        if (Asyncify && Asyncify.state !== 0) return false;
        const Module = (window as unknown as { Module?: { ccall: Function } }).Module;
        if (!Module?.ccall) return false;
        const json = Module.ccall('agent_get_state', 'string', [], []);
        const state = JSON.parse(json as string);
        return Array.isArray(state.units) && state.units.length > 0;
      } catch { return false; }
    }, { timeout: 60_000, polling: 500 });

    // Wait for TS __rngTagControl to be available
    await tsPage.waitForFunction(
      () => typeof (window as any).__rngTagControl === 'function',
      { timeout: 30_000, polling: 500 },
    );

    console.log('Both engines ready');

    // ── Read WASM init state ──
    const wasmInitState = await wasmPage.evaluate(() => {
      const Module = (window as unknown as { Module: { ccall: Function } }).Module;
      const state = JSON.parse(Module.ccall('agent_get_state', 'string', [], []) as string);
      return {
        tick: state.tick as number,
        rngState: state.rngState as number,
        rngCalls: state.rngCalls as number,
      };
    });
    console.log(`WASM init: tick=${wasmInitState.tick} seed=${wasmInitState.rngState} calls=${wasmInitState.rngCalls}`);

    // ── Sync TS seed to WASM ──
    await tsPage.evaluate((targetSeed: number) => {
      (window as any).__syncRngSeed(targetSeed);
    }, wasmInitState.rngState);

    // Disable the built-in tick 1-15 audit logging in TS (we control it ourselves)
    // We can do this by ensuring _tagLogging stays under our control.
    // The update() method will set _tagLogging=true at tick 1 and false at tick 16.
    // Our __rngTagControl overrides will re-enable/disable each tick anyway,
    // but the update() will also clear _seedLog at tick 1. We need to handle that.
    // Actually, the update() code at tick 1 does:
    //   ScenarioRandom._tagLogging = true;
    //   ScenarioRandom._taggedLog = [];
    //   ScenarioRandom._seedLog = [];
    // This would wipe our log. Since we enable+reset BEFORE stepping, and then
    // the engine's update() at tick 1 will ALSO reset it, the log we read back
    // will actually be correct for tick 1 (reset happens at start of update,
    // before any entity processing).
    // For ticks 2-15, the engine re-records _rngAuditTickStart but doesn't reset _seedLog.
    // Our approach: enable+reset BEFORE step, read AFTER step. The engine's own
    // _tagLogging being true won't interfere since we already enabled it.
    // The only issue is at tick 1 where the engine resets _seedLog.
    // Since our reset happens before __agentStep which calls game.step() which calls update(),
    // the engine's reset at tick 1 will clear what we reset. Net effect: correct.

    // Also sync TS callCount to match WASM
    await tsPage.evaluate((targetCalls: number) => {
      // Access through __rngTagControl read to confirm current state
      const data = (window as any).__rngTagControl('read');
      console.log(`[sync] TS callCount=${data.callCount} seed=${data.seed}, target calls=${targetCalls}`);
    }, wasmInitState.rngCalls);

    const tsInitState = await tsPage.evaluate(() => {
      const state = (window as any).__agentState();
      return {
        tick: state.tick as number,
        rngState: state.rngState as number,
        rngCalls: state.rngCalls as number,
      };
    });
    console.log(`TS init: tick=${tsInitState.tick} seed=${tsInitState.rngState} calls=${tsInitState.rngCalls}`);

    const seedMatch = wasmInitState.rngState === tsInitState.rngState;
    console.log(seedMatch ? 'Seeds synchronized successfully' : 'WARNING: Seeds differ after sync!');

    // ── Tick-by-tick comparison ──
    const results: TickComparison[] = [];
    let prevWasmCalls = wasmInitState.rngCalls;
    let prevTsCalls = tsInitState.rngCalls;
    let firstDivergenceTick = -1;
    const divergenceDetails: {
      tick: number;
      wasmLog: Array<[number, number]>;
      tsLog: Array<[number, number]>;
      wasmState: RngTickState;
      tsState: RngTickState;
    }[] = [];

    console.log('\n=== TICK-BY-TICK RNG COMPARISON ===\n');
    console.log('tick | WASM seed      | TS seed        | WASM calls (delta) | TS calls (delta) | match');
    console.log('-----|----------------|----------------|--------------------|------------------|------');

    for (let targetTick = 1; targetTick <= MAX_TICK; targetTick++) {
      // Step both engines one tick
      const [wasmState, tsState] = await Promise.all([
        wasmStepOne(wasmPage),
        tsStepOne(tsPage),
      ]);

      if ((wasmState as any).error) {
        console.log(`WASM error at tick ${targetTick}: ${(wasmState as any).error}`);
        break;
      }
      if ((tsState as any).error) {
        console.log(`TS error at tick ${targetTick}: ${(tsState as any).error}`);
        break;
      }

      const wasmDelta = wasmState.rngCalls - prevWasmCalls;
      const tsDelta = tsState.rngCalls - prevTsCalls;
      const match = wasmState.rngState === tsState.rngState;

      const comp: TickComparison = {
        tick: targetTick,
        wasmSeed: wasmState.rngState,
        tsSeed: tsState.rngState,
        wasmCalls: wasmState.rngCalls,
        tsCalls: tsState.rngCalls,
        wasmTickDelta: wasmDelta,
        tsTickDelta: tsDelta,
        seedMatch: match,
        wasmUnits: wasmState.unitCount,
        tsUnits: tsState.unitCount,
        wasmEnemies: wasmState.enemyCount,
        tsEnemies: tsState.enemyCount,
      };
      results.push(comp);

      const matchStr = match ? 'OK' : '** DIVERGED **';
      console.log(
        `${String(targetTick).padStart(4)} | ` +
        `${String(wasmState.rngState).padStart(14)} | ` +
        `${String(tsState.rngState).padStart(14)} | ` +
        `${String(wasmState.rngCalls).padStart(10)} (${String(wasmDelta).padStart(3)}) | ` +
        `${String(tsState.rngCalls).padStart(8)} (${String(tsDelta).padStart(3)}) | ` +
        matchStr,
      );

      if (!match && firstDivergenceTick === -1) {
        firstDivergenceTick = targetTick;
        console.log(`\n*** FIRST DIVERGENCE AT TICK ${targetTick} ***`);
        console.log(`  WASM: seed=${wasmState.rngState} calls=${wasmState.rngCalls} delta=${wasmDelta}`);
        console.log(`  TS:   seed=${tsState.rngState} calls=${tsState.rngCalls} delta=${tsDelta}`);
        console.log(`  WASM entities: ${wasmState.unitCount} units, ${wasmState.enemyCount} enemies, ${wasmState.structureCount} structures`);
        console.log(`  TS entities:   ${tsState.unitCount} units, ${tsState.enemyCount} enemies, ${tsState.structureCount} structures`);
      }

      // Capture detailed logs for the divergence tick and a few after
      if (firstDivergenceTick > 0 && targetTick >= firstDivergenceTick && targetTick <= firstDivergenceTick + 2) {
        divergenceDetails.push({
          tick: targetTick,
          wasmLog: wasmState.rngLog,
          tsLog: tsState.rngLog,
          wasmState,
          tsState,
        });
      }

      prevWasmCalls = wasmState.rngCalls;
      prevTsCalls = tsState.rngCalls;

      // Stop 5 ticks past divergence
      if (firstDivergenceTick > 0 && targetTick >= firstDivergenceTick + 5) {
        console.log(`\nStopping at tick ${targetTick} (5 ticks past first divergence)`);
        break;
      }
    }

    // ── Detailed divergence analysis ──
    if (firstDivergenceTick > 0 && divergenceDetails.length > 0) {
      console.log('\n=== DIVERGENCE ANALYSIS ===\n');

      for (const detail of divergenceDetails) {
        console.log(`--- Tick ${detail.tick} ---`);
        console.log(`WASM: ${detail.wasmLog.length} RNG calls this tick, seed=${detail.wasmState.rngState}`);
        console.log(`TS:   ${detail.tsLog.length} RNG calls this tick, seed=${detail.tsState.rngState}`);

        // Category breakdown
        const wasmCats = categorizeRngLog(detail.wasmLog);
        const tsCats = categorizeRngLog(detail.tsLog);

        console.log('\n  Category comparison:');
        const allCats = new Set([...Object.keys(wasmCats), ...Object.keys(tsCats)]);
        for (const cat of [...allCats].sort()) {
          const w = wasmCats[cat] || 0;
          const t = tsCats[cat] || 0;
          const diff = w - t;
          const diffStr = diff === 0 ? '  ' : (diff > 0 ? ` +${diff} WASM` : ` +${-diff} TS`);
          console.log(`    ${cat}: WASM=${w} TS=${t}${diffStr}`);
        }

        // Detailed per-entity tag comparison
        console.log('\n  Per-entity tag detail:');
        const wasmByTag = groupByTag(detail.wasmLog);
        const tsByTag = groupByTag(detail.tsLog);
        const allTags = new Set([...wasmByTag.keys(), ...tsByTag.keys()]);
        for (const tag of [...allTags].sort((a, b) => a - b)) {
          const wCount = wasmByTag.get(tag) || 0;
          const tCount = tsByTag.get(tag) || 0;
          if (wCount !== tCount) {
            console.log(`    ${tagName(tag)}: WASM=${wCount} TS=${tCount}`);
          }
        }

        // Call-by-call comparison
        console.log(`\n  Call-by-call (first ${Math.min(Math.max(detail.wasmLog.length, detail.tsLog.length), 70)}):`);
        const maxEntries = Math.max(detail.wasmLog.length, detail.tsLog.length);
        let firstDivIdx = -1;
        for (let i = 0; i < Math.min(maxEntries, 70); i++) {
          const wEntry = detail.wasmLog[i];
          const tEntry = detail.tsLog[i];
          const wStr = wEntry ? `seed=${(wEntry[0] >>> 0).toString().padStart(10)} ${tagName(wEntry[1]).padEnd(12)}` : '(none)'.padEnd(24);
          const tStr = tEntry ? `seed=${(tEntry[0] >>> 0).toString().padStart(10)} ${tagName(tEntry[1]).padEnd(12)}` : '(none)'.padEnd(24);
          const seedMatch2 = wEntry && tEntry && wEntry[0] === tEntry[0];
          const tagMatch = wEntry && tEntry && wEntry[1] === tEntry[1];
          const marker = !wEntry || !tEntry ? '!!' : (!seedMatch2 ? '!!' : (!tagMatch ? '~T' : '  '));
          console.log(`    ${marker} #${String(i).padStart(2)}: WASM[${wStr}]  TS[${tStr}]`);
          if (firstDivIdx === -1 && marker === '!!') {
            firstDivIdx = i;
          }
        }

        if (firstDivIdx >= 0) {
          console.log(`\n  >>> First seed divergence at call #${firstDivIdx} within tick ${detail.tick}`);
          const wEntry = detail.wasmLog[firstDivIdx];
          const tEntry = detail.tsLog[firstDivIdx];
          if (wEntry && tEntry) {
            console.log(`      WASM: seed=${wEntry[0]} tag=${tagName(wEntry[1])}`);
            console.log(`      TS:   seed=${tEntry[0]} tag=${tagName(tEntry[1])}`);
            if (wEntry[1] !== tEntry[1]) {
              console.log(`      Tags differ: WASM doing ${tagName(wEntry[1])}, TS doing ${tagName(tEntry[1])}`);
              console.log(`      Likely cause: entity processing order difference`);
            } else {
              console.log(`      Same tag but different seed: seeds already diverged from prior tick/call`);
            }
          } else if (!tEntry) {
            console.log(`      TS has fewer calls (${detail.tsLog.length}) — WASM extra call: ${tagName(wEntry![1])}`);
          } else {
            console.log(`      WASM has fewer calls (${detail.wasmLog.length}) — TS extra call: ${tagName(tEntry![1])}`);
          }
        }
      }

      // ── Root cause summary ──
      console.log('\n=== ROOT CAUSE SUMMARY ===\n');
      const d = divergenceDetails[0];

      // Look at the tick BEFORE divergence (if we have it)
      const prevTickIdx = firstDivergenceTick - 2; // results array is 0-indexed
      if (prevTickIdx >= 0) {
        const prevComp = results[prevTickIdx];
        console.log(`Tick ${prevComp.tick} (last matching): WASM calls=${prevComp.wasmCalls} TS calls=${prevComp.tsCalls}`);
      }
      console.log(`Tick ${d.tick} (first divergence):`);
      console.log(`  WASM: ${d.wasmLog.length} calls this tick`);
      console.log(`  TS:   ${d.tsLog.length} calls this tick`);
      const callDiff = d.wasmLog.length - d.tsLog.length;
      if (callDiff > 0) {
        console.log(`  WASM makes ${callDiff} more call(s) than TS on this tick`);
      } else if (callDiff < 0) {
        console.log(`  TS makes ${-callDiff} more call(s) than WASM on this tick`);
      } else {
        console.log(`  Same number of calls but different sequence (ordering issue)`);
      }

      // Identify which categories differ
      const wasmCats = categorizeRngLog(d.wasmLog);
      const tsCats = categorizeRngLog(d.tsLog);
      const diffCats: string[] = [];
      for (const cat of new Set([...Object.keys(wasmCats), ...Object.keys(tsCats)])) {
        const w = wasmCats[cat] || 0;
        const t = tsCats[cat] || 0;
        if (w !== t) diffCats.push(`${cat}: WASM=${w} TS=${t} (${w - t > 0 ? 'WASM +' + (w - t) : 'TS +' + (t - w)})`);
      }
      if (diffCats.length > 0) {
        console.log('  Differing categories:');
        for (const dc of diffCats) console.log(`    ${dc}`);
      }
    } else if (firstDivergenceTick === -1) {
      console.log(`\n=== PERFECT PARITY: No divergence through tick ${MAX_TICK} ===`);
    }

    // ── Save report ──
    const report = {
      scenario: SCENARIO,
      wasmBaseUrl: WASM_BASE,
      tsBaseUrl: TS_BASE,
      maxTick: MAX_TICK,
      firstDivergenceTick,
      wasmInitState,
      tsInitState,
      tickComparisons: results,
      divergenceDetails: divergenceDetails.map(d => ({
        tick: d.tick,
        wasmLogLength: d.wasmLog.length,
        tsLogLength: d.tsLog.length,
        wasmLog: d.wasmLog,
        tsLog: d.tsLog,
      })),
    };
    saveJson(report, path.join(OUT_DIR, 'rng-divergence-report.json'));
    console.log(`\nReport saved to ${OUT_DIR}/rng-divergence-report.json`);

    fs.writeFileSync(path.join(OUT_DIR, 'wasm-console.log'), wasmLogs.join('\n'));
    fs.writeFileSync(path.join(OUT_DIR, 'ts-console.log'), tsLogs.join('\n'));

    await wasmCtx.close();
    await tsCtx.close();
  });
});

// ── Utility functions ──────────────────────────────────────

function tagName(tag: number): string {
  if (tag >= 10000 && tag < 11000) return `INF[${tag - 10000}]`;
  if (tag >= 11000 && tag < 12000) return `UNIT[${tag - 11000}]`;
  if (tag >= 12000 && tag < 13000) return `BLDG[${tag - 12000}]`;
  if (tag >= 13000 && tag < 14000) return `ACFT[${tag - 13000}]`;
  return `tag=${tag}`;
}

function categorizeRngLog(log: Array<[number, number]>): Record<string, number> {
  const cats: Record<string, number> = {};
  for (const [, tag] of log) {
    let cat: string;
    if (tag >= 10000 && tag < 11000) cat = 'infantry';
    else if (tag >= 11000 && tag < 12000) cat = 'unit';
    else if (tag >= 12000 && tag < 13000) cat = 'building';
    else if (tag >= 13000 && tag < 14000) cat = 'aircraft';
    else cat = `other(${tag})`;
    cats[cat] = (cats[cat] || 0) + 1;
  }
  return cats;
}

function groupByTag(log: Array<[number, number]>): Map<number, number> {
  const map = new Map<number, number>();
  for (const [, tag] of log) {
    map.set(tag, (map.get(tag) || 0) + 1);
  }
  return map;
}
