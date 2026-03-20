/**
 * M8 Dual-Runtime Comparison Test
 *
 * Orchestrates both the TS and C++ WASM game engines running SCG08EA (Allied
 * Mission 8), each driven by an independent Oracle AI.  Captures paired
 * screenshots and state snapshots every 100 ticks for up to 2700 ticks, tracks
 * combat/movement/production events, computes pixel diffs, and generates a
 * markdown divergence report.
 *
 * This test always passes -- it is a comparison tool, not an assertion suite.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';

import type { AgentState, AgentUnit } from '../engine/agentHarness.js';
import { OracleStrategy, type OracleDecision } from '../oracle/OracleStrategy.js';
import { SharedTsOracleStrategy, type TsOracleDecision } from '../oracle/SharedOracleBridge.js';
import type { RAGameState, RAEntity, RAProduction, AgentStepResult } from '../oracle/WasmAdapter.js';
import {
  ensureParityServer,
  stopParityServer,
  withDualScenario,
  type DualRuntimeHandle,
  type ParityServerHandle,
} from './dual-runtime-test-utils.js';

// ── Output paths ─────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve(__dirname, '..', '..', '..', 'docs', 'm8-comparison');
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'screenshots');
const STATE_DIR = path.join(OUTPUT_DIR, 'states');

// ── Data types ───────────────────────────────────────────────────────────────

interface Snapshot {
  tick: number;
  tsState: AgentState;
  wasmState: RAGameState;
  tsScreenshot: Buffer;
  wasmScreenshot: Buffer;
  pixelDiff: PixelDiffResult;
}

interface UnitDeath {
  tick: number;
  runtime: 'ts' | 'wasm';
  unitType: string;
  unitId: number;
}

interface CombatEvent {
  tick: number;
  runtime: 'ts' | 'wasm';
  unitType: string;
  unitId: number;
  hpBefore: number;
  hpAfter: number;
  damage: number;
}

interface MovementSample {
  tick: number;
  runtime: 'ts' | 'wasm';
  unitType: string;
  unitId: number;
  distance: number;
}

interface ProductionEvent {
  tick: number;
  runtime: 'ts' | 'wasm';
  itemType: string;
  event: 'started' | 'completed';
  progress: number; // 0-100
}

interface PixelDiffResult {
  totalPixels: number;
  diffPixels: number;
  diffPercent: number;
  diffImagePath: string | null;
}

// ── Unit extraction helpers ──────────────────────────────────────────────────

interface UnitInfo {
  id: number;
  type: string;
  hp: number;
}

interface UnitInfoWithPos extends UnitInfo {
  cx: number;
  cy: number;
}

function allUnits(state: AgentState): UnitInfo[] {
  return [
    ...state.units.map((u) => ({ id: u.id, type: u.t, hp: u.hp })),
    ...state.enemies.map((u) => ({ id: u.id, type: u.t, hp: u.hp })),
  ];
}

function allWasmUnits(state: RAGameState): UnitInfo[] {
  return [
    ...state.units.map((u) => ({ id: u.id, type: u.t, hp: u.hp })),
    ...state.enemies.map((u) => ({ id: u.id, type: u.t, hp: u.hp })),
  ];
}

function allUnitsWithPos(state: AgentState): UnitInfoWithPos[] {
  return [
    ...state.units.map((u) => ({ id: u.id, type: u.t, hp: u.hp, cx: u.cx, cy: u.cy })),
    ...state.enemies.map((u) => ({ id: u.id, type: u.t, hp: u.hp, cx: u.cx, cy: u.cy })),
  ];
}

function allWasmUnitsWithPos(state: RAGameState): UnitInfoWithPos[] {
  return [
    ...state.units.map((u) => ({ id: u.id, type: u.t, hp: u.hp, cx: u.cx, cy: u.cy })),
    ...state.enemies.map((u) => ({ id: u.id, type: u.t, hp: u.hp, cx: u.cx, cy: u.cy })),
  ];
}

// ── Tracking helpers ─────────────────────────────────────────────────────────

function trackDeaths(
  tick: number,
  prevTs: AgentState,
  currTs: AgentState,
  prevWasm: RAGameState,
  currWasm: RAGameState,
): UnitDeath[] {
  const deaths: UnitDeath[] = [];

  const prevTsIds = new Map(allUnits(prevTs).map((u) => [u.id, u]));
  const currTsIds = new Set(allUnits(currTs).map((u) => u.id));
  for (const [id, unit] of prevTsIds) {
    if (!currTsIds.has(id)) {
      deaths.push({ tick, runtime: 'ts', unitType: unit.type, unitId: id });
    }
  }

  const prevWasmIds = new Map(allWasmUnits(prevWasm).map((u) => [u.id, u]));
  const currWasmIds = new Set(allWasmUnits(currWasm).map((u) => u.id));
  for (const [id, unit] of prevWasmIds) {
    if (!currWasmIds.has(id)) {
      deaths.push({ tick, runtime: 'wasm', unitType: unit.type, unitId: id });
    }
  }

  return deaths;
}

function trackCombat(
  tick: number,
  prevTs: AgentState,
  currTs: AgentState,
  prevWasm: RAGameState,
  currWasm: RAGameState,
): CombatEvent[] {
  const events: CombatEvent[] = [];

  const prevTsMap = new Map(allUnits(prevTs).map((u) => [u.id, u]));
  for (const unit of allUnits(currTs)) {
    const prev = prevTsMap.get(unit.id);
    if (prev && unit.hp < prev.hp) {
      events.push({
        tick,
        runtime: 'ts',
        unitType: unit.type,
        unitId: unit.id,
        hpBefore: prev.hp,
        hpAfter: unit.hp,
        damage: prev.hp - unit.hp,
      });
    }
  }

  const prevWasmMap = new Map(allWasmUnits(prevWasm).map((u) => [u.id, u]));
  for (const unit of allWasmUnits(currWasm)) {
    const prev = prevWasmMap.get(unit.id);
    if (prev && unit.hp < prev.hp) {
      events.push({
        tick,
        runtime: 'wasm',
        unitType: unit.type,
        unitId: unit.id,
        hpBefore: prev.hp,
        hpAfter: unit.hp,
        damage: prev.hp - unit.hp,
      });
    }
  }

  return events;
}

function trackMovement(
  tick: number,
  prevTs: AgentState,
  currTs: AgentState,
  prevWasm: RAGameState,
  currWasm: RAGameState,
): MovementSample[] {
  const samples: MovementSample[] = [];

  const prevTsMap = new Map(allUnitsWithPos(prevTs).map((u) => [u.id, u]));
  for (const unit of allUnitsWithPos(currTs)) {
    const prev = prevTsMap.get(unit.id);
    if (prev) {
      const dx = unit.cx - prev.cx;
      const dy = unit.cy - prev.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        samples.push({ tick, runtime: 'ts', unitType: unit.type, unitId: unit.id, distance: dist });
      }
    }
  }

  const prevWasmMap = new Map(allWasmUnitsWithPos(prevWasm).map((u) => [u.id, u]));
  for (const unit of allWasmUnitsWithPos(currWasm)) {
    const prev = prevWasmMap.get(unit.id);
    if (prev) {
      const dx = unit.cx - prev.cx;
      const dy = unit.cy - prev.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        samples.push({ tick, runtime: 'wasm', unitType: unit.type, unitId: unit.id, distance: dist });
      }
    }
  }

  return samples;
}

function trackProduction(
  tick: number,
  prevTs: AgentState,
  currTs: AgentState,
  prevWasm: RAGameState,
  currWasm: RAGameState,
): ProductionEvent[] {
  const events: ProductionEvent[] = [];

  // TS production: .prog is 0-1, convert to 0-100
  const prevTsProd = new Map(prevTs.production.map((p) => [p.t, Math.round(p.prog * 100)]));
  for (const item of currTs.production) {
    const currProg = Math.round(item.prog * 100);
    const prevProg = prevTsProd.get(item.t);
    if (prevProg === undefined) {
      events.push({ tick, runtime: 'ts', itemType: item.t, event: 'started', progress: currProg });
    } else if (currProg >= 100 && prevProg < 100) {
      events.push({ tick, runtime: 'ts', itemType: item.t, event: 'completed', progress: currProg });
    }
  }

  // WASM production: .prog is 0-100
  const prevWasmProd = new Map(prevWasm.production.map((p) => [p.t, p.prog]));
  for (const item of currWasm.production) {
    const prevProg = prevWasmProd.get(item.t);
    if (prevProg === undefined) {
      events.push({ tick, runtime: 'wasm', itemType: item.t, event: 'started', progress: item.prog });
    } else if (item.prog >= 100 && prevProg < 100) {
      events.push({ tick, runtime: 'wasm', itemType: item.t, event: 'completed', progress: item.prog });
    }
  }
  // Detect items that completed and were removed from queue
  for (const [type, prog] of prevWasmProd) {
    if (!currWasm.production.some((p) => p.t === type) && prog > 0) {
      events.push({ tick, runtime: 'wasm', itemType: type, event: 'completed', progress: 100 });
    }
  }
  for (const [type, prog] of prevTsProd) {
    if (!currTs.production.some((p) => p.t === type) && prog > 0) {
      events.push({ tick, runtime: 'ts', itemType: type, event: 'completed', progress: 100 });
    }
  }

  return events;
}

async function computePixelDiff(
  tsScreenshot: Buffer,
  wasmScreenshot: Buffer,
  outputPath: string,
): Promise<PixelDiffResult> {
  const { PNG } = await import('pngjs');
  const pixelmatch = (await import('pixelmatch')).default;

  const tsPng = PNG.sync.read(tsScreenshot);
  const wasmPng = PNG.sync.read(wasmScreenshot);

  // Use the smaller dimensions if screenshots differ in size
  const width = Math.min(tsPng.width, wasmPng.width);
  const height = Math.min(tsPng.height, wasmPng.height);
  const totalPixels = width * height;

  // Crop RGBA data to shared dimensions
  function cropRgba(png: { data: Buffer; width: number; height: number }, w: number, h: number): Buffer {
    if (png.width === w && png.height === h) return png.data;
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      const srcOffset = y * png.width * 4;
      const dstOffset = y * w * 4;
      png.data.copy(out, dstOffset, srcOffset, srcOffset + w * 4);
    }
    return out;
  }

  const tsData = cropRgba(tsPng, width, height);
  const wasmData = cropRgba(wasmPng, width, height);

  const diffPng = new PNG({ width, height });
  const diffPixels = pixelmatch(tsData, wasmData, diffPng.data, width, height, { threshold: 0.1 });
  const diffPercent = totalPixels > 0 ? (diffPixels / totalPixels) * 100 : 0;

  let diffImagePath: string | null = null;
  if (diffPixels > 0) {
    diffImagePath = outputPath;
    fs.writeFileSync(diffImagePath, PNG.sync.write(diffPng));
  }

  return { totalPixels, diffPixels, diffPercent, diffImagePath };
}

// ── Report generator ─────────────────────────────────────────────────────────

function generateReport(
  snapshots: Snapshot[],
  deaths: UnitDeath[],
  combatEvents: CombatEvent[],
  movementSamples: MovementSample[],
  productionEvents: ProductionEvent[],
  finalTick: number,
  tsOutcome: string,
  wasmOutcome: string,
  crashError?: string,
): string {
  const lines: string[] = [];

  lines.push('# M8 (SCG08EA) Dual-Runtime Comparison Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Final tick: ${finalTick}`);
  lines.push(`TS outcome: ${tsOutcome}`);
  lines.push(`WASM outcome: ${wasmOutcome}`);
  if (crashError) {
    lines.push('');
    lines.push(`> **PARTIAL REPORT** -- one or both runtimes crashed: ${crashError}`);
  }
  lines.push('');

  // ── 1. Unit Stats at Mission Start ────────────────────────────────────────

  lines.push('## Unit Stats at Mission Start');
  lines.push('');
  if (snapshots.length > 0) {
    const first = snapshots[0];
    const tsMaxHp = new Map<string, number>();
    const wasmMaxHp = new Map<string, number>();

    for (const u of [...first.tsState.units, ...first.tsState.enemies]) {
      const existing = tsMaxHp.get(u.t);
      if (!existing || u.mhp > existing) tsMaxHp.set(u.t, u.mhp);
    }
    for (const u of [...first.wasmState.units, ...first.wasmState.enemies]) {
      const existing = wasmMaxHp.get(u.t);
      if (!existing || u.mhp > existing) wasmMaxHp.set(u.t, u.mhp);
    }

    const allTypes = new Set([...tsMaxHp.keys(), ...wasmMaxHp.keys()]);
    lines.push('| Unit Type | TS Max HP | WASM Max HP | Match |');
    lines.push('|-----------|-----------|-------------|-------|');
    for (const type of [...allTypes].sort()) {
      const tsHp = tsMaxHp.get(type) ?? '-';
      const wasmHp = wasmMaxHp.get(type) ?? '-';
      const match = tsHp === wasmHp ? 'Yes' : '**NO**';
      lines.push(`| ${type} | ${tsHp} | ${wasmHp} | ${match} |`);
    }
    lines.push('');
  }

  // ── 2. Death Counts by Unit Type ──────────────────────────────────────────

  lines.push('## Death Counts by Unit Type');
  lines.push('');
  const tsDeathCounts = new Map<string, number>();
  const wasmDeathCounts = new Map<string, number>();
  for (const d of deaths) {
    const map = d.runtime === 'ts' ? tsDeathCounts : wasmDeathCounts;
    map.set(d.unitType, (map.get(d.unitType) ?? 0) + 1);
  }
  const deathTypes = new Set([...tsDeathCounts.keys(), ...wasmDeathCounts.keys()]);
  lines.push('| Unit Type | TS Deaths | WASM Deaths | Delta |');
  lines.push('|-----------|-----------|-------------|-------|');
  for (const type of [...deathTypes].sort()) {
    const tsD = tsDeathCounts.get(type) ?? 0;
    const wasmD = wasmDeathCounts.get(type) ?? 0;
    const delta = Math.abs(tsD - wasmD);
    lines.push(`| ${type} | ${tsD} | ${wasmD} | ${delta} |`);
  }
  lines.push('');

  // ── 3. Average Damage Taken Per Hit by Unit Type ──────────────────────────

  lines.push('## Average Damage Taken Per Hit by Unit Type');
  lines.push('');
  const tsDmgByType = new Map<string, number[]>();
  const wasmDmgByType = new Map<string, number[]>();
  for (const e of combatEvents) {
    const map = e.runtime === 'ts' ? tsDmgByType : wasmDmgByType;
    const arr = map.get(e.unitType) ?? [];
    arr.push(e.damage);
    map.set(e.unitType, arr);
  }
  const combatTypes = new Set([...tsDmgByType.keys(), ...wasmDmgByType.keys()]);
  lines.push('| Unit Type | TS Avg Dmg | WASM Avg Dmg | Diff % | Flag |');
  lines.push('|-----------|------------|--------------|--------|------|');
  for (const type of [...combatTypes].sort()) {
    const tsArr = tsDmgByType.get(type) ?? [];
    const wasmArr = wasmDmgByType.get(type) ?? [];
    const tsAvg = tsArr.length > 0 ? tsArr.reduce((a, b) => a + b, 0) / tsArr.length : 0;
    const wasmAvg = wasmArr.length > 0 ? wasmArr.reduce((a, b) => a + b, 0) / wasmArr.length : 0;
    const maxAvg = Math.max(tsAvg, wasmAvg);
    const diffPct = maxAvg > 0 ? (Math.abs(tsAvg - wasmAvg) / maxAvg) * 100 : 0;
    const flag = diffPct > 15 ? '**>15%**' : '';
    lines.push(`| ${type} | ${tsAvg.toFixed(1)} (n=${tsArr.length}) | ${wasmAvg.toFixed(1)} (n=${wasmArr.length}) | ${diffPct.toFixed(1)}% | ${flag} |`);
  }
  lines.push('');

  // ── 4. Average Speed by Unit Type ─────────────────────────────────────────

  lines.push('## Average Speed by Unit Type');
  lines.push('');
  const tsSpeedByType = new Map<string, number[]>();
  const wasmSpeedByType = new Map<string, number[]>();
  for (const s of movementSamples) {
    const map = s.runtime === 'ts' ? tsSpeedByType : wasmSpeedByType;
    const arr = map.get(s.unitType) ?? [];
    arr.push(s.distance);
    map.set(s.unitType, arr);
  }
  const speedTypes = new Set([...tsSpeedByType.keys(), ...wasmSpeedByType.keys()]);
  lines.push('| Unit Type | TS Avg Speed | WASM Avg Speed | Diff % | Flag |');
  lines.push('|-----------|--------------|----------------|--------|------|');
  for (const type of [...speedTypes].sort()) {
    const tsArr = tsSpeedByType.get(type) ?? [];
    const wasmArr = wasmSpeedByType.get(type) ?? [];
    const tsAvg = tsArr.length > 0 ? tsArr.reduce((a, b) => a + b, 0) / tsArr.length : 0;
    const wasmAvg = wasmArr.length > 0 ? wasmArr.reduce((a, b) => a + b, 0) / wasmArr.length : 0;
    const maxAvg = Math.max(tsAvg, wasmAvg);
    const diffPct = maxAvg > 0 ? (Math.abs(tsAvg - wasmAvg) / maxAvg) * 100 : 0;
    const flag = diffPct > 5 ? '**>5%**' : '';
    lines.push(`| ${type} | ${tsAvg.toFixed(2)} (n=${tsArr.length}) | ${wasmAvg.toFixed(2)} (n=${wasmArr.length}) | ${diffPct.toFixed(1)}% | ${flag} |`);
  }
  lines.push('');

  // ── 5. Average Build Duration by Type ─────────────────────────────────────

  lines.push('## Average Build Duration by Type');
  lines.push('');
  // Calculate build durations from start->complete pairs
  const tsBuildStarts = new Map<string, number[]>();
  const wasmBuildStarts = new Map<string, number[]>();
  const tsBuildDurations = new Map<string, number[]>();
  const wasmBuildDurations = new Map<string, number[]>();

  for (const e of productionEvents) {
    const startsMap = e.runtime === 'ts' ? tsBuildStarts : wasmBuildStarts;
    const dursMap = e.runtime === 'ts' ? tsBuildDurations : wasmBuildDurations;
    if (e.event === 'started') {
      const arr = startsMap.get(e.itemType) ?? [];
      arr.push(e.tick);
      startsMap.set(e.itemType, arr);
    } else if (e.event === 'completed') {
      const starts = startsMap.get(e.itemType);
      if (starts && starts.length > 0) {
        const startTick = starts.shift()!;
        const duration = e.tick - startTick;
        const arr = dursMap.get(e.itemType) ?? [];
        arr.push(duration);
        dursMap.set(e.itemType, arr);
      }
    }
  }

  const buildTypes = new Set([...tsBuildDurations.keys(), ...wasmBuildDurations.keys()]);
  lines.push('| Item Type | TS Avg Ticks | WASM Avg Ticks | Diff % | Flag |');
  lines.push('|-----------|--------------|----------------|--------|------|');
  for (const type of [...buildTypes].sort()) {
    const tsArr = tsBuildDurations.get(type) ?? [];
    const wasmArr = wasmBuildDurations.get(type) ?? [];
    const tsAvg = tsArr.length > 0 ? tsArr.reduce((a, b) => a + b, 0) / tsArr.length : 0;
    const wasmAvg = wasmArr.length > 0 ? wasmArr.reduce((a, b) => a + b, 0) / wasmArr.length : 0;
    const maxAvg = Math.max(tsAvg, wasmAvg);
    const diffPct = maxAvg > 0 ? (Math.abs(tsAvg - wasmAvg) / maxAvg) * 100 : 0;
    const flag = diffPct > 10 ? '**>10%**' : '';
    lines.push(`| ${type} | ${tsAvg.toFixed(0)} (n=${tsArr.length}) | ${wasmAvg.toFixed(0)} (n=${wasmArr.length}) | ${diffPct.toFixed(1)}% | ${flag} |`);
  }
  lines.push('');

  // ── 6. Mission Timer Comparison ───────────────────────────────────────────

  lines.push('## Mission Timer Comparison');
  lines.push('');
  if (snapshots.length > 0) {
    const last = snapshots[snapshots.length - 1];
    const tsMissionTimer = last.tsState.missionTimer ?? 0;
    const wasmMissionTimer = last.wasmState.missionTimer ?? 0;
    const timerDiff = Math.abs(tsMissionTimer - wasmMissionTimer);
    const flag = timerDiff > 50 ? '**>50 ticks**' : '';
    lines.push(`| Runtime | Mission Timer | Flag |`);
    lines.push(`|---------|---------------|------|`);
    lines.push(`| TS      | ${tsMissionTimer} | |`);
    lines.push(`| WASM    | ${wasmMissionTimer} | |`);
    lines.push(`| Delta   | ${timerDiff} | ${flag} |`);
    lines.push('');
  }

  // ── 7. Visual Pixel Diff ──────────────────────────────────────────────────

  lines.push('## Visual Pixel Diff Summary');
  lines.push('');
  lines.push('| Tick | Total Pixels | Diff Pixels | Diff % | Flag |');
  lines.push('|------|--------------|-------------|--------|------|');
  for (const snap of snapshots) {
    const flag = snap.pixelDiff.diffPercent > 5 ? '**>5%**' : '';
    lines.push(
      `| ${snap.tick} | ${snap.pixelDiff.totalPixels} | ${snap.pixelDiff.diffPixels} | ${snap.pixelDiff.diffPercent.toFixed(2)}% | ${flag} |`,
    );
  }
  lines.push('');

  // ── 8. Production Timeline ────────────────────────────────────────────────

  lines.push('## Production Timeline');
  lines.push('');
  lines.push('| Tick | Runtime | Item | Event | Progress |');
  lines.push('|------|---------|------|-------|----------|');
  for (const e of productionEvents.sort((a, b) => a.tick - b.tick || a.runtime.localeCompare(b.runtime))) {
    lines.push(`| ${e.tick} | ${e.runtime} | ${e.itemType} | ${e.event} | ${e.progress}% |`);
  }
  lines.push('');

  // ── 9. Structure Counts Over Time ─────────────────────────────────────────

  lines.push('## Structure Counts Over Time');
  lines.push('');
  lines.push('| Tick | TS Allied Structs | WASM Allied Structs | TS Enemy Structs | WASM Enemy Structs |');
  lines.push('|------|-------------------|---------------------|------------------|--------------------|');
  for (const snap of snapshots) {
    const tsAllied = snap.tsState.structures.filter((s) => s.ally).length;
    const wasmAllied = snap.wasmState.structures.filter((s) => s.ally).length;
    const tsEnemy = snap.tsState.structures.filter((s) => !s.ally).length;
    const wasmEnemy = snap.wasmState.structures.filter((s) => !s.ally).length;
    lines.push(`| ${snap.tick} | ${tsAllied} | ${wasmAllied} | ${tsEnemy} | ${wasmEnemy} |`);
  }
  lines.push('');

  // ── 10. Screenshot Pairs ──────────────────────────────────────────────────

  lines.push('## Screenshot Pairs');
  lines.push('');
  for (const snap of snapshots) {
    lines.push(`### Tick ${snap.tick}`);
    lines.push('');
    lines.push(`| TS | WASM | Diff |`);
    lines.push(`|----|------|------|`);
    const tsRelPath = `screenshots/ts-${snap.tick}.png`;
    const wasmRelPath = `screenshots/wasm-${snap.tick}.png`;
    const diffRelPath = snap.pixelDiff.diffImagePath
      ? `screenshots/diff-${snap.tick}.png`
      : 'n/a';
    lines.push(`| ![TS](${tsRelPath}) | ![WASM](${wasmRelPath}) | ![Diff](${diffRelPath}) |`);
    lines.push('');
  }

  return lines.join('\n');
}

// ── Test suite ───────────────────────────────────────────────────────────────

let serverHandle: ParityServerHandle | undefined;

beforeAll(async () => {
  serverHandle = await ensureParityServer();
}, 180_000);

afterAll(async () => {
  await stopParityServer(serverHandle);
}, 20_000);

describe('M8 Dual-Runtime Comparison', () => {
  it('runs SCG08EA on both TS and WASM and generates divergence report', async () => {
    // Ensure output directories exist
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    fs.mkdirSync(STATE_DIR, { recursive: true });

    const SCENARIO = 'SCG08EA';
    const MAX_TICKS = 2700;
    const STEP_SIZE = 10;
    const SNAPSHOT_INTERVAL = 100;

    const snapshots: Snapshot[] = [];
    const deaths: UnitDeath[] = [];
    const combatEvents: CombatEvent[] = [];
    const movementSamples: MovementSample[] = [];
    const productionEvents: ProductionEvent[] = [];

    let finalTick = 0;
    let tsOutcome = 'playing';
    let wasmOutcome = 'playing';
    let crashError: string | undefined;

    await withDualScenario(SCENARIO, async (handle: DualRuntimeHandle) => {
      const tsOracle = new SharedTsOracleStrategy(SCENARIO);
      const wasmOracle = new OracleStrategy(SCENARIO);

      let currentTick = 0;
      let prevTsState = handle.tsState;
      let prevWasmState = handle.wasmState;

      // Take initial snapshot at tick 0
      const [tsScreenshot0, wasmScreenshot0] = await Promise.all([
        handle.ts.screenshot(),
        handle.wasm.screenshot(),
      ]);
      const diffPath0 = path.join(SCREENSHOT_DIR, `diff-0.png`);
      const pixelDiff0 = await computePixelDiff(tsScreenshot0, wasmScreenshot0, diffPath0);

      fs.writeFileSync(path.join(SCREENSHOT_DIR, 'ts-0.png'), tsScreenshot0);
      fs.writeFileSync(path.join(SCREENSHOT_DIR, 'wasm-0.png'), wasmScreenshot0);
      fs.writeFileSync(path.join(STATE_DIR, 'ts-0.json'), JSON.stringify(handle.tsState, null, 2));
      fs.writeFileSync(path.join(STATE_DIR, 'wasm-0.json'), JSON.stringify(handle.wasmState, null, 2));

      snapshots.push({
        tick: 0,
        tsState: handle.tsState,
        wasmState: handle.wasmState,
        tsScreenshot: tsScreenshot0,
        wasmScreenshot: wasmScreenshot0,
        pixelDiff: pixelDiff0,
      });

      try {
        while (currentTick < MAX_TICKS) {
          // Oracle decides for each runtime independently
          const tsDecision = tsOracle.decide(prevTsState);
          const wasmDecision = wasmOracle.decide(prevWasmState);

          // Step both runtimes in parallel
          const [tsResult, wasmResult] = await Promise.all([
            handle.ts.step(STEP_SIZE, tsDecision.commands),
            handle.wasm.step(
              STEP_SIZE,
              wasmDecision.commands.length > 0 ? JSON.stringify(wasmDecision.commands) : undefined,
            ),
          ]);

          currentTick += STEP_SIZE;
          finalTick = currentTick;

          const currTsState = tsResult.state;
          const currWasmState = wasmResult.state;

          // Track events
          deaths.push(...trackDeaths(currentTick, prevTsState, currTsState, prevWasmState, currWasmState));
          combatEvents.push(...trackCombat(currentTick, prevTsState, currTsState, prevWasmState, currWasmState));
          movementSamples.push(...trackMovement(currentTick, prevTsState, currTsState, prevWasmState, currWasmState));
          productionEvents.push(...trackProduction(currentTick, prevTsState, currTsState, prevWasmState, currWasmState));

          // Snapshot every SNAPSHOT_INTERVAL ticks
          if (currentTick % SNAPSHOT_INTERVAL === 0) {
            const [tsScreenshot, wasmScreenshot] = await Promise.all([
              handle.ts.screenshot(),
              handle.wasm.screenshot(),
            ]);

            const diffPath = path.join(SCREENSHOT_DIR, `diff-${currentTick}.png`);
            const pixelDiff = await computePixelDiff(tsScreenshot, wasmScreenshot, diffPath);

            fs.writeFileSync(path.join(SCREENSHOT_DIR, `ts-${currentTick}.png`), tsScreenshot);
            fs.writeFileSync(path.join(SCREENSHOT_DIR, `wasm-${currentTick}.png`), wasmScreenshot);
            fs.writeFileSync(
              path.join(STATE_DIR, `ts-${currentTick}.json`),
              JSON.stringify(currTsState, null, 2),
            );
            fs.writeFileSync(
              path.join(STATE_DIR, `wasm-${currentTick}.json`),
              JSON.stringify(currWasmState, null, 2),
            );

            snapshots.push({
              tick: currentTick,
              tsState: currTsState,
              wasmState: currWasmState,
              tsScreenshot,
              wasmScreenshot,
              pixelDiff,
            });
          }

          // Check mission completion
          tsOutcome = tsOracle.checkResult(currTsState);
          wasmOutcome = wasmOracle.checkResult(currWasmState);

          if (tsOutcome !== 'playing' || wasmOutcome !== 'playing') {
            // Take a final snapshot on completion
            if (currentTick % SNAPSHOT_INTERVAL !== 0) {
              const [tsScreenshot, wasmScreenshot] = await Promise.all([
                handle.ts.screenshot(),
                handle.wasm.screenshot(),
              ]);

              const diffPath = path.join(SCREENSHOT_DIR, `diff-${currentTick}.png`);
              const pixelDiff = await computePixelDiff(tsScreenshot, wasmScreenshot, diffPath);

              fs.writeFileSync(path.join(SCREENSHOT_DIR, `ts-${currentTick}.png`), tsScreenshot);
              fs.writeFileSync(path.join(SCREENSHOT_DIR, `wasm-${currentTick}.png`), wasmScreenshot);
              fs.writeFileSync(
                path.join(STATE_DIR, `ts-${currentTick}.json`),
                JSON.stringify(currTsState, null, 2),
              );
              fs.writeFileSync(
                path.join(STATE_DIR, `wasm-${currentTick}.json`),
                JSON.stringify(currWasmState, null, 2),
              );

              snapshots.push({
                tick: currentTick,
                tsState: currTsState,
                wasmState: currWasmState,
                tsScreenshot,
                wasmScreenshot,
                pixelDiff,
              });
            }
            break;
          }

          prevTsState = currTsState;
          prevWasmState = currWasmState;
        }
      } catch (error) {
        crashError = error instanceof Error ? error.message : String(error);
      }

      // Generate report (always -- even on crash we produce a partial report)
      const report = generateReport(
        snapshots,
        deaths,
        combatEvents,
        movementSamples,
        productionEvents,
        finalTick,
        tsOutcome,
        wasmOutcome,
        crashError,
      );

      fs.writeFileSync(path.join(OUTPUT_DIR, 'REPORT.md'), report);
    });

    // Test always passes -- this is a comparison tool
  }, 1_200_000);
});
