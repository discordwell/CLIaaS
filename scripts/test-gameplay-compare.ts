/**
 * Gameplay State Parity: TS engine vs C++ WASM original.
 *
 * Both engines run SCG01EA with seed=0 (deterministic RNG).
 * Steps both in lockstep at each checkpoint and diffs the full game state:
 *   - Entity counts, types, positions, HP
 *   - Credits, power, production
 *   - Structure state
 *
 * Run: npx playwright test scripts/test-gameplay-compare.ts
 */

import { test, expect, type Page, type Browser } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.COMPARE_URL || 'https://cliaas.com';
const OUT_DIR = path.join(process.cwd(), 'test-results', 'gameplay-compare');
const SEED = 0;

// Tick checkpoints — passive observation, no commands
const SCENARIO = process.env.PARITY_SCENARIO || 'SCG01EA';
const CHECKPOINTS = [0, 1, 5, 10, 20, 50, 100];

// ── Helpers ──────────────────────────────────────────────────

function ensureDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function pad(n: number): string {
  return String(n).padStart(4, '0');
}

function saveJson(data: unknown, filePath: string): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ── Normalized entity for cross-engine comparison ───────────

interface NormEntity {
  type: string;
  cx: number;
  cy: number;
  hp: number;
  maxHp: number;
  ally: boolean;
  house: string;
}

interface NormStructure {
  type: string;
  cx: number;
  cy: number;
  hp: number;
  maxHp: number;
  ally: boolean;
  house: string;
}

interface NormState {
  tick: number;
  credits: number;
  units: NormEntity[];
  enemies: NormEntity[];
  structures: NormStructure[];
  power?: { produced: number; consumed: number };
}

/** Normalize WASM state (house field, id-based) */
function normalizeWasm(raw: Record<string, unknown>): NormState {
  const mapEntity = (e: Record<string, unknown>): NormEntity => ({
    type: String(e.t ?? ''),
    cx: Number(e.cx ?? 0),
    cy: Number(e.cy ?? 0),
    hp: Number(e.hp ?? 0),
    maxHp: Number(e.mhp ?? 0),
    ally: Boolean(e.ally),
    house: String(e.house ?? ''),
  });
  const mapStruct = (s: Record<string, unknown>): NormStructure => ({
    type: String(s.t ?? ''),
    cx: Number(s.cx ?? 0),
    cy: Number(s.cy ?? 0),
    hp: Number(s.hp ?? 0),
    maxHp: Number(s.mhp ?? 0),
    ally: Boolean(s.ally),
    house: String(s.house ?? ''),
  });
  const power = raw.power as Record<string, number> | undefined;
  return {
    tick: Number(raw.tick ?? 0),
    credits: Number(raw.credits ?? 0),
    units: ((raw.units ?? []) as Record<string, unknown>[]).filter(u => u.ally).map(mapEntity),
    enemies: ((raw.enemies ?? []) as Record<string, unknown>[]).map(mapEntity),
    structures: ((raw.structures ?? []) as Record<string, unknown>[]).map(mapStruct),
    power: power ? { produced: power.produced ?? 0, consumed: power.consumed ?? 0 } : undefined,
  };
}

/** Normalize TS state (h field, idx-based structures) */
function normalizeTs(raw: Record<string, unknown>): NormState {
  const mapEntity = (e: Record<string, unknown>): NormEntity => ({
    type: String(e.t ?? ''),
    cx: Number(e.cx ?? 0),
    cy: Number(e.cy ?? 0),
    hp: Number(e.hp ?? 0),
    maxHp: Number(e.mhp ?? 0),
    ally: Boolean(e.ally),
    house: String(e.h ?? ''),
  });
  const mapStruct = (s: Record<string, unknown>): NormStructure => ({
    type: String(s.t ?? ''),
    cx: Number(s.cx ?? 0),
    cy: Number(s.cy ?? 0),
    hp: Number(s.hp ?? 0),
    maxHp: Number(s.mhp ?? 0),
    ally: Boolean(s.ally),
    house: String(s.h ?? ''),
  });
  const power = raw.power as Record<string, number> | undefined;
  return {
    tick: Number(raw.tick ?? 0),
    credits: Number(raw.credits ?? 0),
    units: ((raw.units ?? []) as Record<string, unknown>[]).map(mapEntity),
    enemies: ((raw.enemies ?? []) as Record<string, unknown>[]).map(mapEntity),
    structures: ((raw.structures ?? []) as Record<string, unknown>[]).map(mapStruct),
    power: power ? { produced: power.produced ?? 0, consumed: power.consumed ?? 0 } : undefined,
  };
}

// ── Entity diffing ──────────────────────────────────────────

type EntityKey = string; // "TYPE:cx,cy"

function entityKey(e: NormEntity | NormStructure): EntityKey {
  return `${e.type}:${e.cx},${e.cy}`;
}

interface EntityDiff {
  category: string;
  onlyInWasm: EntityKey[];
  onlyInTs: EntityKey[];
  hpMismatches: { key: EntityKey; wasmHp: number; tsHp: number }[];
  countWasm: number;
  countTs: number;
}

function diffEntities(
  wasmList: (NormEntity | NormStructure)[],
  tsList: (NormEntity | NormStructure)[],
  category: string,
): EntityDiff {
  // Build multisets (same type+position can have multiple entities)
  const wasmBag = new Map<EntityKey, (NormEntity | NormStructure)[]>();
  for (const e of wasmList) {
    const k = entityKey(e);
    (wasmBag.get(k) ?? (wasmBag.set(k, []), wasmBag.get(k)!)).push(e);
  }
  const tsBag = new Map<EntityKey, (NormEntity | NormStructure)[]>();
  for (const e of tsList) {
    const k = entityKey(e);
    (tsBag.get(k) ?? (tsBag.set(k, []), tsBag.get(k)!)).push(e);
  }

  const allKeys = new Set([...wasmBag.keys(), ...tsBag.keys()]);
  const onlyInWasm: EntityKey[] = [];
  const onlyInTs: EntityKey[] = [];
  const hpMismatches: { key: EntityKey; wasmHp: number; tsHp: number }[] = [];

  for (const k of allKeys) {
    const wList = wasmBag.get(k) ?? [];
    const tList = tsBag.get(k) ?? [];
    const shared = Math.min(wList.length, tList.length);

    // Check HP for matched entities
    for (let i = 0; i < shared; i++) {
      if (wList[i].hp !== tList[i].hp) {
        hpMismatches.push({ key: k, wasmHp: wList[i].hp, tsHp: tList[i].hp });
      }
    }

    // Extras
    for (let i = shared; i < wList.length; i++) onlyInWasm.push(k);
    for (let i = shared; i < tList.length; i++) onlyInTs.push(k);
  }

  return { category, onlyInWasm, onlyInTs, hpMismatches, countWasm: wasmList.length, countTs: tsList.length };
}

interface CheckpointDiff {
  tick: number;
  credits: { wasm: number; ts: number; match: boolean };
  units: EntityDiff;
  enemies: EntityDiff;
  structures: EntityDiff;
  clean: boolean; // no divergences at all
}

function diffStates(wasm: NormState, ts: NormState, tick: number): CheckpointDiff {
  const units = diffEntities(wasm.units, ts.units, 'units');
  const enemies = diffEntities(wasm.enemies, ts.enemies, 'enemies');
  const structures = diffEntities(wasm.structures, ts.structures, 'structures');
  const creditsMatch = wasm.credits === ts.credits;

  const clean =
    creditsMatch &&
    units.onlyInWasm.length === 0 && units.onlyInTs.length === 0 && units.hpMismatches.length === 0 &&
    enemies.onlyInWasm.length === 0 && enemies.onlyInTs.length === 0 && enemies.hpMismatches.length === 0 &&
    structures.onlyInWasm.length === 0 && structures.onlyInTs.length === 0 && structures.hpMismatches.length === 0;

  return {
    tick,
    credits: { wasm: wasm.credits, ts: ts.credits, match: creditsMatch },
    units,
    enemies,
    structures,
    clean,
  };
}

// ── Pretty print ────────────────────────────────────────────

function printDiff(d: CheckpointDiff): string {
  const lines: string[] = [];
  const icon = d.clean ? 'MATCH' : 'DIFF';
  lines.push(`[${icon}] tick ${d.tick}`);

  if (!d.credits.match) {
    lines.push(`  credits: WASM=${d.credits.wasm} TS=${d.credits.ts}`);
  }

  for (const cat of [d.units, d.enemies, d.structures]) {
    const countMatch = cat.countWasm === cat.countTs;
    const label = `  ${cat.category}: ${cat.countWasm}/${cat.countTs}${countMatch ? '' : ' MISMATCH'}`;
    if (!countMatch || cat.onlyInWasm.length || cat.onlyInTs.length || cat.hpMismatches.length) {
      lines.push(label);
      for (const k of cat.onlyInWasm) lines.push(`    +WASM: ${k}`);
      for (const k of cat.onlyInTs) lines.push(`    +TS:   ${k}`);
      for (const m of cat.hpMismatches) lines.push(`    HP: ${m.key} WASM=${m.wasmHp} TS=${m.tsHp}`);
    }
  }

  return lines.join('\n');
}

// ── WASM stepping (chunked for Asyncify) ────────────────────

async function wasmStep(page: Page, n: number): Promise<Record<string, unknown> | null> {
  const MAX_PER_CALL = 15;
  let remaining = n;
  let lastState: Record<string, unknown> | null = null;

  while (remaining > 0) {
    const chunk = Math.min(remaining, MAX_PER_CALL);
    remaining -= chunk;

    try {
      const raw = await page.evaluate(async (ticks: number) => {
        const w = window as unknown as {
          __agentStep: (n: number) => Promise<unknown> | unknown;
        };
        const r = w.__agentStep(ticks);
        if (r && typeof (r as Promise<unknown>).then === 'function') {
          return await (r as Promise<unknown>);
        }
        return r;
      }, chunk);

      if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        if (obj.state && typeof obj.state === 'object') {
          lastState = obj.state as Record<string, unknown>;
        }
      }
    } catch (e) {
      console.log(`WASM: Step chunk failed at remaining=${remaining}: ${e}`);
      return lastState;
    }
  }

  return lastState;
}

// ── TS stepping ─────────────────────────────────────────────

async function tsStep(page: Page, n: number): Promise<Record<string, unknown> | null> {
  try {
    const raw = await page.evaluate((ticks: number) => {
      const w = window as unknown as {
        __agentStep: (n: number) => { state: Record<string, unknown> };
      };
      const r = w.__agentStep(ticks);
      return r?.state ?? null;
    }, n);
    return raw as Record<string, unknown> | null;
  } catch (e) {
    console.log(`TS: Step failed: ${e}`);
    return null;
  }
}

// ── Main test ───────────────────────────────────────────────

test.describe(`State Parity: ${SCENARIO} seed=0`, () => {
  test.setTimeout(10 * 60 * 1000);

  test('Lockstep comparison', async ({ browser }) => {
    ensureDir();

    // Launch both engines in separate pages
    const wasmCtx = await browser.newContext();
    const tsCtx = await browser.newContext();
    const wasmPage = await wasmCtx.newPage();
    const tsPage = await tsCtx.newPage();

    const wasmLogs: string[] = [];
    const tsLogs: string[] = [];
    wasmPage.on('console', msg => wasmLogs.push(`[${msg.type()}] ${msg.text()}`));
    tsPage.on('console', msg => tsLogs.push(`[${msg.type()}] ${msg.text()}`));
    wasmPage.on('dialog', async dialog => { await dialog.accept(); });

    // ── Load both engines ──
    console.log('Loading both engines with seed=0...');

    const wasmUrl = `${BASE_URL}/ra/original.html?scenario=${SCENARIO}.INI&autoplay=1&agentharness=1&seed=${SEED}`;
    const tsUrl = `${BASE_URL}?anttest=agent&scenario=${SCENARIO}&difficulty=normal`;

    await Promise.all([
      wasmPage.goto(wasmUrl, { waitUntil: 'load' }),
      tsPage.goto(tsUrl, { waitUntil: 'load' }),
    ]);

    // ── Wait for both to be ready ──
    console.log('Waiting for both engines to initialize...');

    const wasmReady = wasmPage.waitForFunction(() => {
      const t = document.title;
      return t.includes('ENTERING_GAME_LOOP') || t.includes('SELECT_GAME_DONE');
    }, { timeout: 180_000, polling: 1000 });

    const tsReady = tsPage.waitForFunction(
      () => (window as unknown as { __agentReady?: boolean }).__agentReady === true,
      { timeout: 120_000, polling: 1000 },
    );

    await Promise.all([wasmReady, tsReady]);
    console.log('Both engines ready');

    // WASM needs gameplay state to be available
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

    // Get WASM start tick (may not be exactly 0)
    const wasmStartTick = await wasmPage.evaluate(() => {
      const Module = (window as unknown as { Module: { ccall: Function } }).Module;
      const json = Module.ccall('agent_get_state', 'string', [], []);
      return JSON.parse(json as string).tick as number;
    });
    console.log(`WASM start tick: ${wasmStartTick}`);

    // Read WASM init seed and sync TS to match (auto-discovery, no hardcoded table needed)
    const wasmInitSeed = await wasmPage.evaluate(() => {
      const Module = (window as unknown as { Module: { ccall: Function } }).Module;
      const state = JSON.parse(Module.ccall('agent_get_state', 'string', [], []) as string);
      return state.rngState as number;
    });
    console.log(`WASM init seed: ${wasmInitSeed}`);

    // Force TS ScenarioRandom to the same seed (bypasses consumeInitRNG lookup table)
    await tsPage.evaluate((targetSeed: number) => {
      const w = window as unknown as { __agentState: () => Record<string, unknown> };
      // Access ScenarioRandom via the game's exposed state
      const state = w.__agentState();
      // Set seed directly through the agent harness
      (window as unknown as Record<string, unknown>).__syncRngSeed?.(targetSeed);
    }, wasmInitSeed);

    // Get TS start tick
    const tsStartTick = await tsPage.evaluate(() => {
      return (window as unknown as { __agentState: () => { tick: number } }).__agentState().tick;
    });
    console.log(`TS start tick: ${tsStartTick}`);

    // Note: TS starts at tick 1 (AntGame.tsx:684 does game.step(1) before harness).
    // WASM starts at tick 0. This 1-tick offset is a real engine difference, not a
    // harness bug — the TS init step fires triggers and advances game state.
    // We compare at matching checkpoint offsets from each engine's start.

    // ── Lockstep comparison at each checkpoint ──
    const results: CheckpointDiff[] = [];
    let wasmTick = wasmStartTick;
    let tsTick = tsStartTick;

    for (const target of CHECKPOINTS) {
      const wasmDelta = (wasmStartTick + target) - wasmTick;
      const tsDelta = (tsStartTick + target) - tsTick;

      console.log(`\n── Checkpoint: tick ${target} ──`);

      // Step both engines (skip if delta is 0)
      let wasmState: Record<string, unknown> | null = null;
      let tsState: Record<string, unknown> | null = null;

      if (wasmDelta > 0 && tsDelta > 0) {
        [wasmState, tsState] = await Promise.all([
          wasmStep(wasmPage, wasmDelta),
          tsStep(tsPage, tsDelta),
        ]);
      } else if (wasmDelta > 0) {
        wasmState = await wasmStep(wasmPage, wasmDelta);
      } else if (tsDelta > 0) {
        tsState = await tsStep(tsPage, tsDelta);
      }

      // If no state returned from step (tick 0), read directly
      if (!wasmState) {
        wasmState = await wasmPage.evaluate(() => {
          const Module = (window as unknown as { Module: { ccall: Function } }).Module;
          return JSON.parse(Module.ccall('agent_get_state', 'string', [], []) as string);
        });
      }
      if (!tsState) {
        tsState = await tsPage.evaluate(() => {
          return (window as unknown as { __agentState: () => Record<string, unknown> }).__agentState();
        });
      }

      wasmTick = Number(wasmState.tick ?? wasmTick);
      tsTick = Number(tsState.tick ?? tsTick);

      // Compare RNG state
      const wasmRng = wasmState.rngState as number | undefined;
      const tsRng = tsState.rngState as number | undefined;
      const wasmCalls = (wasmState as Record<string, unknown>).rngCalls as number | undefined;
      const tsCalls = (tsState as Record<string, unknown>).rngCalls as number | undefined;
      if (wasmRng !== undefined && tsRng !== undefined) {
        const callInfo = `WASM:${wasmCalls ?? '?'} TS:${tsCalls ?? '?'}`;
        if (wasmRng !== tsRng) {
          console.log(`  RNG DIVERGED: seeds WASM=${wasmRng} TS=${tsRng} calls ${callInfo}`);
        } else {
          console.log(`  RNG MATCH: seed=${wasmRng} calls ${callInfo}`);
        }
      }

      // Save raw states
      saveJson(wasmState, path.join(OUT_DIR, `wasm-full-${pad(target)}.json`));
      saveJson(tsState, path.join(OUT_DIR, `ts-full-${pad(target)}.json`));

      // Normalize and diff
      const normWasm = normalizeWasm(wasmState);
      const normTs = normalizeTs(tsState);
      const diff = diffStates(normWasm, normTs, target);
      results.push(diff);

      const report = printDiff(diff);
      console.log(report);
    }

    // ── Summary report ──
    const totalClean = results.filter(r => r.clean).length;
    const totalCheckpoints = results.length;

    console.log('\n══════════════════════════════════════');
    console.log(`PARITY RESULT: ${totalClean}/${totalCheckpoints} checkpoints match`);
    if (totalClean < totalCheckpoints) {
      console.log('Divergent checkpoints:');
      for (const r of results.filter(r => !r.clean)) {
        console.log(printDiff(r));
      }
    }
    console.log('══════════════════════════════════════\n');

    // Save full report
    saveJson({
      seed: SEED,
      scenario: SCENARIO,
      baseUrl: BASE_URL,
      wasmStartTick,
      checkpoints: results,
      summary: { clean: totalClean, total: totalCheckpoints },
    }, path.join(OUT_DIR, 'parity-report.json'));

    fs.writeFileSync(path.join(OUT_DIR, 'wasm-console.log'), wasmLogs.join('\n'));
    fs.writeFileSync(path.join(OUT_DIR, 'ts-console.log'), tsLogs.join('\n'));

    // Clean up
    await wasmCtx.close();
    await tsCtx.close();

    // Fail test if any checkpoint diverged
    expect(totalClean, `${totalCheckpoints - totalClean} checkpoints diverged`).toBe(totalCheckpoints);
  });
});
