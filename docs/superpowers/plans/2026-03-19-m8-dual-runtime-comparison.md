# M8 Dual-Runtime Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run SCG08EA on both TS and C++ WASM engines with the Oracle driving each independently, capturing paired screenshots and state snapshots every 100 ticks for the full 2700-tick mission, then generate a divergence report.

**Architecture:** A vitest test file orchestrates both runtimes via existing TsAgentAdapter + WasmAdapter. The TS side uses SharedTsOracleStrategy (which normalizes state and translates commands). The WASM side uses OracleStrategy directly. A DivergenceAnalyzer post-processes collected snapshots into a categorized markdown report.

**Tech Stack:** Vitest, Playwright (headless), TsAgentAdapter, WasmAdapter, SharedOracleBridge, OracleStrategy, pixelmatch (screenshot diff)

**Spec:** `docs/superpowers/specs/2026-03-19-m8-dual-runtime-comparison-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/EasterEgg/oracle/SharedOracleBridge.ts` | **Modify:** extend `translateOracleDecisionToTs()` to handle `produce`, `place`, `sell`, `repair` commands |
| `src/EasterEgg/__tests__/dual-runtime-m8-comparison.test.ts` | **Create:** main comparison test — runs both runtimes, captures snapshots, generates report |
| `docs/m8-comparison/` | **Create:** output directory for screenshots, states, and REPORT.md |

---

### Task 1: Extend SharedOracleBridge with Production Command Translation

The Oracle generates production commands in WASM format (`{ cmd: 'produce', rtti, type_id }`). The TS harness expects `{ cmd: 'build', type: 'HTNK' }`. We need to bridge this gap.

**Files:**
- Modify: `src/EasterEgg/oracle/SharedOracleBridge.ts:121-173`
- Test: `src/EasterEgg/__tests__/shared-oracle-bridge-production.test.ts`

- [ ] **Step 1: Write failing tests for production command translation**

Create `src/EasterEgg/__tests__/shared-oracle-bridge-production.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { translateOracleDecisionToTs, type TsStateBridge } from '../oracle/SharedOracleBridge';

// Minimal bridge for testing — no structure index lookups needed for production
const EMPTY_BRIDGE: TsStateBridge = {
  normalizedState: {} as any,
  structureIndexById: new Map(),
};

describe('translateOracleDecisionToTs — production commands', () => {
  it('translates produce RTTI_BUILDINGTYPE to build command', () => {
    const decision = { commands: [{ cmd: 'produce', rtti: 6, type_id: 17 }], reason: 'test' };
    const { commands, warnings } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toEqual([{ cmd: 'build', type: 'POWR' }]);
    expect(warnings).toHaveLength(0);
  });

  it('translates produce RTTI_UNITTYPE to build command', () => {
    const decision = { commands: [{ cmd: 'produce', rtti: 29, type_id: 2 }], reason: 'test' };
    const { commands } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toEqual([{ cmd: 'build', type: '2TNK' }]);
  });

  it('translates produce RTTI_INFANTRYTYPE to build command', () => {
    const decision = { commands: [{ cmd: 'produce', rtti: 14, type_id: 2 }], reason: 'test' };
    const { commands } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toEqual([{ cmd: 'build', type: 'E3' }]);
  });

  it('translates produce RTTI_VESSELTYPE to build command', () => {
    const decision = { commands: [{ cmd: 'produce', rtti: 33, type_id: 1 }], reason: 'test' };
    const { commands } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toEqual([{ cmd: 'build', type: 'DD' }]);
  });

  it('translates place with coordinates to place command', () => {
    const decision = { commands: [{ cmd: 'place', rtti: 6, cx: 10, cy: 20 }], reason: 'test' };
    const { commands } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toEqual([{ cmd: 'place', cx: 10, cy: 20 }]);
  });

  it('skips place without coordinates (unit exit — TS handles automatically)', () => {
    const decision = { commands: [{ cmd: 'place', rtti: 29 }], reason: 'test' };
    const { commands, warnings } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('translates sell command', () => {
    const bridge: TsStateBridge = {
      normalizedState: {} as any,
      structureIndexById: new Map([[1_000_000_005, 5]]),
    };
    const decision = { commands: [{ cmd: 'sell', target: 1_000_000_005 }], reason: 'test' };
    const { commands } = translateOracleDecisionToTs(decision, bridge);
    expect(commands).toEqual([{ cmd: 'sell', structIdx: 5 }]);
  });

  it('translates repair command', () => {
    const bridge: TsStateBridge = {
      normalizedState: {} as any,
      structureIndexById: new Map([[1_000_000_003, 3]]),
    };
    const decision = { commands: [{ cmd: 'repair', target: 1_000_000_003 }], reason: 'test' };
    const { commands } = translateOracleDecisionToTs(decision, bridge);
    expect(commands).toEqual([{ cmd: 'repair', structIdx: 3 }]);
  });

  it('warns on unknown produce rtti', () => {
    const decision = { commands: [{ cmd: 'produce', rtti: 99, type_id: 0 }], reason: 'test' };
    const { commands, warnings } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/discordwell/Projects/CLIaaS && npx vitest run src/EasterEgg/__tests__/shared-oracle-bridge-production.test.ts`
Expected: FAIL — `produce`, `place`, `sell`, `repair` commands hit the unsupported fallback

- [ ] **Step 3: Add RTTI-to-name reverse mapping tables to SharedOracleBridge**

Add these mappings at the top of `SharedOracleBridge.ts` (below existing imports), derived from the same tables in `OracleStrategy.ts`:

```typescript
const RTTI_BUILDINGTYPE = 6;
const RTTI_UNITTYPE = 29;
const RTTI_INFANTRYTYPE = 14;
const RTTI_VESSELTYPE = 33;

// Reverse mappings: type_id -> type name (from C++ defines.h StructType enum)
const BUILDING_ID_TO_NAME: Record<number, string> = {
  0: 'ATEK', 1: 'IRON', 2: 'WEAP', 3: 'PDOX', 4: 'PBOX', 5: 'HBOX',
  6: 'DOME', 7: 'GAP',  8: 'GUN',  9: 'AGUN', 10: 'FTUR', 11: 'FACT',
  12: 'PROC', 13: 'SILO', 14: 'HPAD', 15: 'SAM', 16: 'AFLD', 17: 'POWR',
  18: 'APWR', 19: 'STEK', 20: 'HOSP', 21: 'BARR', 22: 'TENT', 23: 'KENN',
  24: 'FIX',  25: 'BIO',  26: 'MISS', 27: 'SYRD', 28: 'SPEN', 29: 'MSLO',
  30: 'FCOM', 31: 'TSLA',
};

const UNIT_ID_TO_NAME: Record<number, string> = {
  0: '4TNK', 1: '3TNK', 2: '2TNK', 3: '1TNK', 4: 'APC', 5: 'MNLY',
  6: 'JEEP', 7: 'HARV', 8: 'ARTY', 9: 'MRJ', 10: 'MGG', 11: 'MCV',
  12: 'V2RL', 13: 'TRUK',
};

const INFANTRY_ID_TO_NAME: Record<number, string> = {
  0: 'E1', 1: 'E2', 2: 'E3', 3: 'E4', 4: 'E6', 5: 'E7',
  6: 'SPY', 7: 'THF', 8: 'MEDI', 9: 'GNRL', 10: 'DOG',
};

const VESSEL_ID_TO_NAME: Record<number, string> = {
  0: 'SS', 1: 'DD', 2: 'CA', 3: 'LST', 4: 'PT', 5: 'MSUB',
};

function rttiToName(rtti: number, typeId: number): string | undefined {
  switch (rtti) {
    case RTTI_BUILDINGTYPE: return BUILDING_ID_TO_NAME[typeId];
    case RTTI_UNITTYPE: return UNIT_ID_TO_NAME[typeId];
    case RTTI_INFANTRYTYPE: return INFANTRY_ID_TO_NAME[typeId];
    case RTTI_VESSELTYPE: return VESSEL_ID_TO_NAME[typeId];
    default: return undefined;
  }
}
```

- [ ] **Step 4: Extend `translateOracleDecisionToTs()` with production handlers**

Add these cases inside the `for (const command of decision.commands)` loop, before the unsupported fallback:

```typescript
if (kind === 'produce' && typeof command.rtti === 'number' && typeof command.type_id === 'number') {
  const typeName = rttiToName(command.rtti, command.type_id);
  if (typeName) {
    commands.push({ cmd: 'build', type: typeName });
  } else {
    warnings.push(`Unknown produce rtti=${command.rtti} type_id=${command.type_id}`);
  }
  continue;
}

if (kind === 'place') {
  if (typeof command.cx === 'number' && typeof command.cy === 'number') {
    commands.push({ cmd: 'place', cx: command.cx, cy: command.cy });
  }
  // Unit exit (no coordinates) — TS handles rally point automatically, skip silently
  continue;
}

if (kind === 'sell' && typeof command.target === 'number') {
  const structureIndex = bridge.structureIndexById.get(command.target);
  if (structureIndex !== undefined) {
    commands.push({ cmd: 'sell', structIdx: structureIndex });
  } else {
    warnings.push(`sell: structure id ${command.target} not found`);
  }
  continue;
}

if (kind === 'repair' && typeof command.target === 'number') {
  const structureIndex = bridge.structureIndexById.get(command.target);
  if (structureIndex !== undefined) {
    commands.push({ cmd: 'repair', structIdx: structureIndex });
  } else {
    warnings.push(`repair: structure id ${command.target} not found`);
  }
  continue;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/discordwell/Projects/CLIaaS && npx vitest run src/EasterEgg/__tests__/shared-oracle-bridge-production.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 6: Run existing tests to verify no regressions**

Run: `cd /Users/discordwell/Projects/CLIaaS && npx vitest run src/EasterEgg/__tests__/shared-oracle-bridge-production.test.ts src/EasterEgg/__tests__/dual-runtime-parity.test.ts`
Expected: All existing parity tests still pass

- [ ] **Step 7: Commit**

```bash
git add src/EasterEgg/oracle/SharedOracleBridge.ts src/EasterEgg/__tests__/shared-oracle-bridge-production.test.ts
git commit -m "feat: extend SharedOracleBridge with production command translation

Adds produce, place, sell, repair command translation to
translateOracleDecisionToTs() with RTTI-to-name reverse mappings.
Required for dual-runtime M8 comparison where Oracle drives both engines."
```

---

### Task 2: Install pixel-diff dependencies

- [ ] **Step 1: Install pixelmatch and pngjs**

Run: `cd /Users/discordwell/Projects/CLIaaS && pnpm add -D pixelmatch pngjs @types/pngjs`

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add pixelmatch + pngjs for screenshot comparison"
```

---

### Task 3: Create the Dual-Runtime M8 Comparison Test

This is the main test file that orchestrates both runtimes, captures snapshots, and generates the report.

**Files:**
- Create: `src/EasterEgg/__tests__/dual-runtime-m8-comparison.test.ts`

**Dependencies:** Task 1 (SharedOracleBridge production commands), Task 2 (pixelmatch)

- [ ] **Step 1: Create the test file with setup/teardown and output directory**

Create `src/EasterEgg/__tests__/dual-runtime-m8-comparison.test.ts`:

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';

import type { AgentState } from '../engine/agentHarness.js';
import { OracleStrategy, type OracleDecision } from '../oracle/OracleStrategy.js';
import { SharedTsOracleStrategy, type TsOracleDecision } from '../oracle/SharedOracleBridge.js';
import type { RAGameState } from '../oracle/WasmAdapter.js';
import {
  ensureParityServer,
  stopParityServer,
  withDualScenario,
  type ParityServerHandle,
} from './dual-runtime-test-utils.js';

const SCENARIO = 'SCG08EA';
const TOTAL_TICKS = 2700;
const STEP_SIZE = 10;
const SNAPSHOT_INTERVAL = 100; // ticks between snapshots

const OUTPUT_DIR = path.resolve(__dirname, '..', '..', '..', 'docs', 'm8-comparison');
const SCREENSHOTS_DIR = path.join(OUTPUT_DIR, 'screenshots');
const STATES_DIR = path.join(OUTPUT_DIR, 'states');

// --- Snapshot data types ---

interface Snapshot {
  tick: number;
  tsState: AgentState;
  wasmState: RAGameState;
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
  delta: number;
}

interface MovementSample {
  runtime: 'ts' | 'wasm';
  unitType: string;
  distance: number; // cells moved in one step
}

interface ProductionEvent {
  runtime: 'ts' | 'wasm';
  unitType: string;
  startTick: number;
  endTick: number;
  duration: number;
}

interface PixelDiffResult {
  tick: number;
  diffPixels: number;
  totalPixels: number;
  diffPercent: number;
}

let serverHandle: ParityServerHandle | undefined;

beforeAll(async () => {
  serverHandle = await ensureParityServer();
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  fs.mkdirSync(STATES_DIR, { recursive: true });
}, 180_000);

afterAll(async () => {
  await stopParityServer(serverHandle);
}, 20_000);
```

- [ ] **Step 2: Add the snapshot capture and combat tracking helpers**

Append to the same file:

```typescript
// --- Combat tracking ---

function trackDeaths(
  prevUnits: Array<{ id: number; t: string }>,
  currUnits: Array<{ id: number; t: string }>,
  tick: number,
  runtime: 'ts' | 'wasm',
): UnitDeath[] {
  const currIds = new Set(currUnits.map((u) => u.id));
  return prevUnits
    .filter((u) => !currIds.has(u.id))
    .map((u) => ({ tick, runtime, unitType: u.t, unitId: u.id }));
}

function trackCombat(
  prevUnits: Array<{ id: number; t: string; hp: number }>,
  currUnits: Array<{ id: number; t: string; hp: number }>,
  tick: number,
  runtime: 'ts' | 'wasm',
): CombatEvent[] {
  const currMap = new Map(currUnits.map((u) => [u.id, u]));
  const events: CombatEvent[] = [];
  for (const prev of prevUnits) {
    const curr = currMap.get(prev.id);
    if (curr && curr.hp < prev.hp) {
      events.push({
        tick, runtime,
        unitType: prev.t, unitId: prev.id,
        hpBefore: prev.hp, hpAfter: curr.hp,
        delta: prev.hp - curr.hp,
      });
    }
  }
  return events;
}

function allUnits(state: AgentState): Array<{ id: number; t: string; hp: number }> {
  return [...state.units, ...state.enemies].map((u) => ({ id: u.id, t: u.t, hp: u.hp }));
}

function allWasmUnits(state: RAGameState): Array<{ id: number; t: string; hp: number }> {
  return [...state.units, ...state.enemies].map((u) => ({ id: u.id, t: u.t, hp: u.hp }));
}

// --- Movement tracking ---

function trackMovement(
  prevUnits: Array<{ id: number; t: string; cx: number; cy: number }>,
  currUnits: Array<{ id: number; t: string; cx: number; cy: number }>,
  runtime: 'ts' | 'wasm',
): MovementSample[] {
  const currMap = new Map(currUnits.map((u) => [u.id, u]));
  const samples: MovementSample[] = [];
  for (const prev of prevUnits) {
    const curr = currMap.get(prev.id);
    if (curr) {
      const dx = curr.cx - prev.cx;
      const dy = curr.cy - prev.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        samples.push({ runtime, unitType: prev.t, distance: dist });
      }
    }
  }
  return samples;
}

function allUnitsWithPos(state: AgentState): Array<{ id: number; t: string; cx: number; cy: number }> {
  return [...state.units, ...state.enemies].map((u) => ({ id: u.id, t: u.t, cx: u.cx, cy: u.cy }));
}

function allWasmUnitsWithPos(state: RAGameState): Array<{ id: number; t: string; cx: number; cy: number }> {
  return [...state.units, ...state.enemies].map((u) => ({ id: u.id, t: u.t, cx: u.cx, cy: u.cy }));
}

// --- Production build-time tracking ---

function trackProduction(
  prevProd: Array<{ t: string; prog: number }>,
  currProd: Array<{ t: string; prog: number }>,
  tick: number,
  runtime: 'ts' | 'wasm',
  activeBuilds: Map<string, number>, // key: `${runtime}-${type}`, value: start tick
): ProductionEvent[] {
  const events: ProductionEvent[] = [];
  const currTypes = new Set(currProd.map((p) => p.t));

  // Check for completions: was in prev but not in curr (or prog went to 100)
  for (const prev of prevProd) {
    const key = `${runtime}-${prev.t}`;
    if (!currTypes.has(prev.t) && activeBuilds.has(key)) {
      const startTick = activeBuilds.get(key)!;
      events.push({ runtime, unitType: prev.t, startTick, endTick: tick, duration: tick - startTick });
      activeBuilds.delete(key);
    }
  }

  // Check for new starts: in curr but not tracked
  for (const curr of currProd) {
    const key = `${runtime}-${curr.t}`;
    if (!activeBuilds.has(key)) {
      activeBuilds.set(key, tick);
    }
  }

  return events;
}

// --- Pixel diff ---

async function computePixelDiff(tsPng: Buffer, wasmPng: Buffer, tick: number): Promise<PixelDiffResult> {
  // Decode PNGs to raw RGBA using sharp (available in Node) or canvas
  // Fall back to simple byte comparison if libraries unavailable
  try {
    const { PNG } = await import('pngjs');
    const pixelmatch = (await import('pixelmatch')).default;

    const tsImg = PNG.sync.read(tsPng);
    const wasmImg = PNG.sync.read(wasmPng);

    // Resize to common dimensions if different
    const width = Math.min(tsImg.width, wasmImg.width);
    const height = Math.min(tsImg.height, wasmImg.height);
    const totalPixels = width * height;

    // Crop both to common size
    const tsData = cropRGBA(tsImg.data, tsImg.width, width, height);
    const wasmData = cropRGBA(wasmImg.data, wasmImg.width, width, height);

    const diffPixels = pixelmatch(tsData, wasmData, null, width, height, { threshold: 0.1 });
    return { tick, diffPixels, totalPixels, diffPercent: (diffPixels / totalPixels) * 100 };
  } catch {
    // pixelmatch/pngjs not available — skip pixel diff
    return { tick, diffPixels: -1, totalPixels: -1, diffPercent: -1 };
  }
}

function cropRGBA(data: Buffer, srcWidth: number, dstWidth: number, dstHeight: number): Buffer {
  const out = Buffer.alloc(dstWidth * dstHeight * 4);
  for (let y = 0; y < dstHeight; y++) {
    data.copy(out, y * dstWidth * 4, y * srcWidth * 4, y * srcWidth * 4 + dstWidth * 4);
  }
  return out;
}
```

- [ ] **Step 3: Add the report generation function**

Append to the same file:

```typescript
// --- Report generation ---

function generateReport(
  snapshots: Snapshot[],
  tsDeaths: UnitDeath[],
  wasmDeaths: UnitDeath[],
  tsCombat: CombatEvent[],
  wasmCombat: CombatEvent[],
  tsMovement: MovementSample[],
  wasmMovement: MovementSample[],
  tsProductionEvents: ProductionEvent[],
  wasmProductionEvents: ProductionEvent[],
  pixelDiffs: PixelDiffResult[],
  tsEndTick: number,
  wasmEndTick: number,
  tsResult: string,
  wasmResult: string,
): string {
  const lines: string[] = [];
  lines.push('# M8 Dual-Runtime Comparison Report');
  lines.push('');
  lines.push(`**Scenario:** ${SCENARIO}`);
  lines.push(`**TS result:** ${tsResult} at tick ${tsEndTick}`);
  lines.push(`**WASM result:** ${wasmResult} at tick ${wasmEndTick}`);
  lines.push(`**Snapshots captured:** ${snapshots.length}`);
  lines.push('');

  // --- Stats comparison (from first snapshot) ---
  lines.push('## Unit Stats at Mission Start');
  lines.push('');
  if (snapshots.length > 0) {
    const first = snapshots[0];
    const tsTypes = new Map<string, { hp: number; mhp: number }>();
    const wasmTypes = new Map<string, { hp: number; mhp: number }>();

    for (const u of [...first.tsState.units, ...first.tsState.enemies]) {
      if (!tsTypes.has(u.t)) tsTypes.set(u.t, { hp: u.hp, mhp: u.mhp });
    }
    for (const u of [...first.wasmState.units, ...first.wasmState.enemies]) {
      if (!wasmTypes.has(u.t)) wasmTypes.set(u.t, { hp: u.hp, mhp: u.mhp });
    }

    const allTypes = new Set([...tsTypes.keys(), ...wasmTypes.keys()]);
    lines.push('| Unit Type | TS Max HP | WASM Max HP | Match |');
    lines.push('|-----------|-----------|-------------|-------|');
    for (const t of [...allTypes].sort()) {
      const ts = tsTypes.get(t);
      const wasm = wasmTypes.get(t);
      const tsHp = ts?.mhp ?? 'N/A';
      const wasmHp = wasm?.mhp ?? 'N/A';
      const match = ts && wasm && ts.mhp === wasm.mhp ? 'Y' : '**N**';
      lines.push(`| ${t} | ${tsHp} | ${wasmHp} | ${match} |`);
    }
    lines.push('');
  }

  // --- Death counts by type ---
  lines.push('## Death Counts by Unit Type');
  lines.push('');
  const tsDeathCounts = new Map<string, number>();
  const wasmDeathCounts = new Map<string, number>();
  for (const d of tsDeaths) tsDeathCounts.set(d.unitType, (tsDeathCounts.get(d.unitType) ?? 0) + 1);
  for (const d of wasmDeaths) wasmDeathCounts.set(d.unitType, (wasmDeathCounts.get(d.unitType) ?? 0) + 1);
  const deathTypes = new Set([...tsDeathCounts.keys(), ...wasmDeathCounts.keys()]);

  lines.push('| Unit Type | TS Deaths | WASM Deaths | Diff |');
  lines.push('|-----------|-----------|-------------|------|');
  for (const t of [...deathTypes].sort()) {
    const tsD = tsDeathCounts.get(t) ?? 0;
    const wasmD = wasmDeathCounts.get(t) ?? 0;
    const diff = tsD - wasmD;
    const flag = Math.abs(diff) > Math.max(tsD, wasmD) * 0.3 ? ' **' : '';
    lines.push(`| ${t} | ${tsD} | ${wasmD} | ${diff >= 0 ? '+' : ''}${diff}${flag} |`);
  }
  lines.push('');

  // --- Average damage per hit by unit type ---
  lines.push('## Average Damage Taken Per Hit by Unit Type');
  lines.push('');
  const tsAvgDmg = avgDamageByType(tsCombat);
  const wasmAvgDmg = avgDamageByType(wasmCombat);
  const combatTypes = new Set([...tsAvgDmg.keys(), ...wasmAvgDmg.keys()]);

  lines.push('| Unit Type | TS Avg Dmg/Hit | WASM Avg Dmg/Hit | Diff % |');
  lines.push('|-----------|----------------|------------------|--------|');
  for (const t of [...combatTypes].sort()) {
    const tsA = tsAvgDmg.get(t);
    const wasmA = wasmAvgDmg.get(t);
    if (tsA && wasmA) {
      const diffPct = ((tsA - wasmA) / wasmA * 100).toFixed(1);
      const flag = Math.abs(tsA - wasmA) / wasmA > 0.15 ? ' **FLAGGED**' : '';
      lines.push(`| ${t} | ${tsA.toFixed(1)} | ${wasmA.toFixed(1)} | ${diffPct}%${flag} |`);
    } else {
      lines.push(`| ${t} | ${tsA?.toFixed(1) ?? 'N/A'} | ${wasmA?.toFixed(1) ?? 'N/A'} | - |`);
    }
  }
  lines.push('');

  // --- Movement comparison ---
  lines.push('## Average Speed by Unit Type (cells/step)');
  lines.push('');
  const tsAvgSpeed = avgSpeedByType(tsMovement);
  const wasmAvgSpeed = avgSpeedByType(wasmMovement);
  const moveTypes = new Set([...tsAvgSpeed.keys(), ...wasmAvgSpeed.keys()]);

  lines.push('| Unit Type | TS Avg Speed | WASM Avg Speed | Diff % |');
  lines.push('|-----------|-------------|----------------|--------|');
  for (const t of [...moveTypes].sort()) {
    const tsS = tsAvgSpeed.get(t);
    const wasmS = wasmAvgSpeed.get(t);
    if (tsS && wasmS) {
      const diffPct = ((tsS - wasmS) / wasmS * 100).toFixed(1);
      const flag = Math.abs(tsS - wasmS) / wasmS > 0.05 ? ' **FLAGGED**' : '';
      lines.push(`| ${t} | ${tsS.toFixed(3)} | ${wasmS.toFixed(3)} | ${diffPct}%${flag} |`);
    } else {
      lines.push(`| ${t} | ${tsS?.toFixed(3) ?? 'N/A'} | ${wasmS?.toFixed(3) ?? 'N/A'} | - |`);
    }
  }
  lines.push('');

  // --- Production build-time comparison ---
  lines.push('## Average Build Duration by Type (ticks)');
  lines.push('');
  const tsAvgBuild = avgBuildTimeByType(tsProductionEvents);
  const wasmAvgBuild = avgBuildTimeByType(wasmProductionEvents);
  const buildTypes = new Set([...tsAvgBuild.keys(), ...wasmAvgBuild.keys()]);

  lines.push('| Type | TS Avg Ticks | WASM Avg Ticks | Diff % |');
  lines.push('|------|-------------|----------------|--------|');
  for (const t of [...buildTypes].sort()) {
    const tsB = tsAvgBuild.get(t);
    const wasmB = wasmAvgBuild.get(t);
    if (tsB && wasmB) {
      const diffPct = ((tsB - wasmB) / wasmB * 100).toFixed(1);
      const flag = Math.abs(tsB - wasmB) / wasmB > 0.1 ? ' **FLAGGED**' : '';
      lines.push(`| ${t} | ${tsB.toFixed(0)} | ${wasmB.toFixed(0)} | ${diffPct}%${flag} |`);
    } else {
      lines.push(`| ${t} | ${tsB?.toFixed(0) ?? 'N/A'} | ${wasmB?.toFixed(0) ?? 'N/A'} | - |`);
    }
  }
  lines.push('');

  // --- Mission timer / trigger comparison ---
  lines.push('## Mission Timer Comparison');
  lines.push('');
  lines.push('| Tick | TS Timer | WASM Timer | Diff |');
  lines.push('|------|----------|------------|------|');
  for (const snap of snapshots) {
    const tsTimer = snap.tsState.missionTimer ?? 'N/A';
    const wasmTimer = snap.wasmState.missionTimer ?? 'N/A';
    const diff = typeof tsTimer === 'number' && typeof wasmTimer === 'number'
      ? tsTimer - wasmTimer : '-';
    const flag = typeof diff === 'number' && Math.abs(diff) > 50 ? ' **' : '';
    lines.push(`| ${snap.tick} | ${tsTimer} | ${wasmTimer} | ${diff}${flag} |`);
  }
  lines.push('');

  // --- Pixel diff summary ---
  if (pixelDiffs.some((d) => d.diffPercent >= 0)) {
    lines.push('## Visual Pixel Diff');
    lines.push('');
    lines.push('| Tick | Diff Pixels | Total Pixels | Diff % | Flag |');
    lines.push('|------|-------------|-------------|--------|------|');
    for (const d of pixelDiffs) {
      if (d.diffPercent < 0) continue;
      const flag = d.diffPercent > 5 ? '**FLAGGED**' : '';
      lines.push(`| ${d.tick} | ${d.diffPixels} | ${d.totalPixels} | ${d.diffPercent.toFixed(1)}% | ${flag} |`);
    }
    lines.push('');
  }

  // --- Production comparison ---
  lines.push('## Production Timeline');
  lines.push('');
  lines.push('| Tick | TS Production | WASM Production |');
  lines.push('|------|---------------|-----------------|');
  for (const snap of snapshots) {
    const tsProd = snap.tsState.production?.map((p) => `${p.t}(${Math.round(p.prog * 100)}%)`).join(', ') || '-';
    const wasmProd = snap.wasmState.production?.map((p) => `${p.t}(${p.prog}%)`).join(', ') || '-';
    if (tsProd !== '-' || wasmProd !== '-') {
      lines.push(`| ${snap.tick} | ${tsProd} | ${wasmProd} |`);
    }
  }
  lines.push('');

  // --- Structure comparison at snapshots ---
  lines.push('## Structure Counts Over Time');
  lines.push('');
  lines.push('| Tick | TS Allied Structures | WASM Allied Structures |');
  lines.push('|------|---------------------|------------------------|');
  for (const snap of snapshots) {
    const tsStructs = snap.tsState.structures.filter((s) => s.ally).map((s) => s.t).sort().join(', ');
    const wasmStructs = snap.wasmState.structures.filter((s) => s.ally).map((s) => s.t).sort().join(', ');
    lines.push(`| ${snap.tick} | ${tsStructs} | ${wasmStructs} |`);
  }
  lines.push('');

  // --- Screenshot index ---
  lines.push('## Screenshot Pairs');
  lines.push('');
  lines.push('Visual comparison — review each pair for rendering differences.');
  lines.push('');
  for (const snap of snapshots) {
    const tick = String(snap.tick).padStart(4, '0');
    lines.push(`### Tick ${snap.tick}`);
    lines.push('');
    lines.push(`| TS | WASM |`);
    lines.push(`|---|---|`);
    lines.push(`| ![TS](screenshots/ts-${tick}.png) | ![WASM](screenshots/cpp-${tick}.png) |`);
    lines.push('');
  }

  return lines.join('\n');
}

function avgSpeedByType(samples: MovementSample[]): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const s of samples) {
    const entry = sums.get(s.unitType) ?? { total: 0, count: 0 };
    entry.total += s.distance;
    entry.count += 1;
    sums.set(s.unitType, entry);
  }
  const result = new Map<string, number>();
  for (const [t, { total, count }] of sums) {
    result.set(t, total / count);
  }
  return result;
}

function avgBuildTimeByType(events: ProductionEvent[]): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const e of events) {
    const entry = sums.get(e.unitType) ?? { total: 0, count: 0 };
    entry.total += e.duration;
    entry.count += 1;
    sums.set(e.unitType, entry);
  }
  const result = new Map<string, number>();
  for (const [t, { total, count }] of sums) {
    result.set(t, total / count);
  }
  return result;
}

function avgDamageByType(events: CombatEvent[]): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const e of events) {
    const entry = sums.get(e.unitType) ?? { total: 0, count: 0 };
    entry.total += e.delta;
    entry.count += 1;
    sums.set(e.unitType, entry);
  }
  const result = new Map<string, number>();
  for (const [t, { total, count }] of sums) {
    result.set(t, total / count);
  }
  return result;
}
```

- [ ] **Step 4: Add the main comparison test**

Append the test body:

```typescript
describe('M8 Dual-Runtime Comparison', () => {
  it('runs SCG08EA on both runtimes and generates divergence report', async () => {
    await withDualScenario(SCENARIO, async (handle) => {
      const tsOracle = new SharedTsOracleStrategy(SCENARIO);
      const wasmOracle = new OracleStrategy(SCENARIO);

      const snapshots: Snapshot[] = [];
      const tsDeaths: UnitDeath[] = [];
      const wasmDeaths: UnitDeath[] = [];
      const tsCombat: CombatEvent[] = [];
      const wasmCombat: CombatEvent[] = [];
      const tsMovement: MovementSample[] = [];
      const wasmMovement: MovementSample[] = [];
      const tsProductionEvents: ProductionEvent[] = [];
      const wasmProductionEvents: ProductionEvent[] = [];
      const pixelDiffs: PixelDiffResult[] = [];
      const activeBuilds = new Map<string, number>();

      let currentTick = 0;
      let tsState = handle.tsState;
      let wasmState = handle.wasmState;
      let tsResult = 'playing';
      let wasmResult = 'playing';
      let tsEndTick = TOTAL_TICKS;
      let wasmEndTick = TOTAL_TICKS;

      // Capture initial snapshot
      const tsScreenshot0 = await handle.ts.screenshot();
      const wasmScreenshot0 = await handle.wasm.screenshot();
      fs.writeFileSync(path.join(SCREENSHOTS_DIR, 'ts-0000.png'), tsScreenshot0);
      fs.writeFileSync(path.join(SCREENSHOTS_DIR, 'cpp-0000.png'), wasmScreenshot0);
      fs.writeFileSync(
        path.join(STATES_DIR, 'ts-0000.json'),
        JSON.stringify(tsState, null, 2),
      );
      fs.writeFileSync(
        path.join(STATES_DIR, 'cpp-0000.json'),
        JSON.stringify(wasmState, null, 2),
      );
      snapshots.push({ tick: 0, tsState, wasmState });

      let prevTsUnits = allUnits(tsState);
      let prevWasmUnits = allWasmUnits(wasmState);
      let prevTsPos = allUnitsWithPos(tsState);
      let prevWasmPos = allWasmUnitsWithPos(wasmState);
      let prevTsProd = (tsState.production ?? []).map((p) => ({ t: p.t, prog: Math.round(p.prog * 100) }));
      let prevWasmProd = (wasmState.production ?? []).map((p) => ({ t: p.t, prog: p.prog }));

      try {
        while (currentTick < TOTAL_TICKS) {
          // --- Oracle decisions ---
          let tsCommands: any[] | undefined;
          let wasmCommands: string | undefined;

          if (tsResult === 'playing') {
            const tsDecision = tsOracle.decide(tsState);
            tsCommands = tsDecision.commands;
            if (tsDecision.warnings.length > 0) {
              console.log(`[TS tick=${currentTick}] warnings: ${tsDecision.warnings.join(', ')}`);
            }
          }

          if (wasmResult === 'playing') {
            const wasmDecision = wasmOracle.decide(wasmState);
            wasmCommands = wasmDecision.commands.length > 0
              ? JSON.stringify(wasmDecision.commands)
              : undefined;
          }

          // --- Step both runtimes in parallel ---
          const [tsStep, wasmStep] = await Promise.all([
            tsResult === 'playing'
              ? handle.ts.step(STEP_SIZE, tsCommands)
              : Promise.resolve(null),
            wasmResult === 'playing'
              ? handle.wasm.step(STEP_SIZE, wasmCommands)
              : Promise.resolve(null),
          ]);

          currentTick += STEP_SIZE;

          // Update states
          if (tsStep) tsState = tsStep.state;
          if (wasmStep) wasmState = wasmStep.state;

          // --- Track combat, movement, production events ---
          if (tsStep) {
            const currTsUnits = allUnits(tsState);
            tsDeaths.push(...trackDeaths(prevTsUnits, currTsUnits, currentTick, 'ts'));
            tsCombat.push(...trackCombat(prevTsUnits, currTsUnits, currentTick, 'ts'));
            prevTsUnits = currTsUnits;

            const currTsPos = allUnitsWithPos(tsState);
            tsMovement.push(...trackMovement(prevTsPos, currTsPos, 'ts'));
            prevTsPos = currTsPos;

            const currTsProd = (tsState.production ?? []).map((p) => ({ t: p.t, prog: Math.round(p.prog * 100) }));
            tsProductionEvents.push(...trackProduction(prevTsProd, currTsProd, currentTick, 'ts', activeBuilds));
            prevTsProd = currTsProd;
          }
          if (wasmStep) {
            const currWasmUnits = allWasmUnits(wasmState);
            wasmDeaths.push(...trackDeaths(prevWasmUnits, currWasmUnits, currentTick, 'wasm'));
            wasmCombat.push(...trackCombat(prevWasmUnits, currWasmUnits, currentTick, 'wasm'));
            prevWasmUnits = currWasmUnits;

            const currWasmPos = allWasmUnitsWithPos(wasmState);
            wasmMovement.push(...trackMovement(prevWasmPos, currWasmPos, 'wasm'));
            prevWasmPos = currWasmPos;

            const currWasmProd = (wasmState.production ?? []).map((p) => ({ t: p.t, prog: p.prog }));
            wasmProductionEvents.push(...trackProduction(prevWasmProd, currWasmProd, currentTick, 'wasm', activeBuilds));
            prevWasmProd = currWasmProd;
          }

          // --- Check end conditions ---
          if (tsResult === 'playing') {
            const result = tsOracle.checkResult(tsState);
            if (result !== 'playing') {
              tsResult = result;
              tsEndTick = currentTick;
              console.log(`[TS] Mission ended: ${result} at tick ${currentTick}`);
            }
          }
          if (wasmResult === 'playing') {
            const result = wasmOracle.checkResult(wasmState);
            if (result !== 'playing') {
              wasmResult = result;
              wasmEndTick = currentTick;
              console.log(`[WASM] Mission ended: ${result} at tick ${currentTick}`);
            }
          }

          // --- Capture snapshot at intervals ---
          if (currentTick % SNAPSHOT_INTERVAL === 0) {
            const tickStr = String(currentTick).padStart(4, '0');
            console.log(`[Snapshot] tick=${currentTick}`);

            const [tsPng, wasmPng] = await Promise.all([
              handle.ts.screenshot(),
              handle.wasm.screenshot(),
            ]);

            fs.writeFileSync(path.join(SCREENSHOTS_DIR, `ts-${tickStr}.png`), tsPng);
            fs.writeFileSync(path.join(SCREENSHOTS_DIR, `cpp-${tickStr}.png`), wasmPng);
            fs.writeFileSync(
              path.join(STATES_DIR, `ts-${tickStr}.json`),
              JSON.stringify(tsState, null, 2),
            );
            fs.writeFileSync(
              path.join(STATES_DIR, `cpp-${tickStr}.json`),
              JSON.stringify(wasmState, null, 2),
            );
            snapshots.push({ tick: currentTick, tsState, wasmState });

            // Pixel diff
            const diff = await computePixelDiff(tsPng, wasmPng, currentTick);
            pixelDiffs.push(diff);
            if (diff.diffPercent >= 0) {
              console.log(`  pixel diff: ${diff.diffPercent.toFixed(1)}%`);
            }
          }

          // Both done
          if (tsResult !== 'playing' && wasmResult !== 'playing') break;
        }
      } catch (error) {
        console.error(`[CRASH] at tick ${currentTick}: ${error}`);
        // Generate partial report from whatever we have
      }

      // --- Generate report ---
      const report = generateReport(
        snapshots, tsDeaths, wasmDeaths, tsCombat, wasmCombat,
        tsMovement, wasmMovement, tsProductionEvents, wasmProductionEvents, pixelDiffs,
        tsEndTick, wasmEndTick, tsResult, wasmResult,
      );
      fs.writeFileSync(path.join(OUTPUT_DIR, 'REPORT.md'), report);
      console.log(`\nReport written to ${path.join(OUTPUT_DIR, 'REPORT.md')}`);
      console.log(`Screenshots: ${snapshots.length} pairs in ${SCREENSHOTS_DIR}`);
      console.log(`TS deaths: ${tsDeaths.length}, WASM deaths: ${wasmDeaths.length}`);
      console.log(`TS combat events: ${tsCombat.length}, WASM combat events: ${wasmCombat.length}`);
    });
  }, 1_200_000); // 20 minute timeout
});
```

- [ ] **Step 5: Commit the test file**

```bash
git add src/EasterEgg/__tests__/dual-runtime-m8-comparison.test.ts
git commit -m "feat: M8 dual-runtime comparison test

Runs SCG08EA on both TS and C++ WASM engines with independent
Oracle control, captures paired screenshots + state every 100
ticks, tracks combat events and deaths, generates REPORT.md."
```

---

### Task 4: Add Output Directory and Gitignore

**Files:**
- Create: `docs/m8-comparison/.gitignore`

- [ ] **Step 1: Create the output directory with gitignore**

Create `docs/m8-comparison/.gitignore`:

```
screenshots/
states/
```

This keeps the generated PNGs and JSON out of git while allowing `REPORT.md` to be committed.

- [ ] **Step 2: Commit**

```bash
git add docs/m8-comparison/.gitignore
git commit -m "chore: add m8-comparison output directory with gitignore"
```

---

### Task 5: Run the Comparison and Review Results

**Dependencies:** Tasks 1-4

- [ ] **Step 1: Start the parity server (if not already running)**

Run: `cd /Users/discordwell/Projects/CLIaaS && pnpm next dev --port 3001`
(Run in background — the test will auto-detect if it's already up)

- [ ] **Step 2: Run the comparison test**

Run: `cd /Users/discordwell/Projects/CLIaaS && npx vitest run src/EasterEgg/__tests__/dual-runtime-m8-comparison.test.ts --reporter=verbose`
Expected: Test passes (it's a comparison tool, not an assertion suite). Console output shows snapshot captures and summary stats.

- [ ] **Step 3: Review the generated report**

Read: `docs/m8-comparison/REPORT.md`

Check for:
- Unit stat mismatches (Max HP differences in the first table)
- Death count imbalances (>30% difference for any unit type)
- Damage-per-hit divergences (>15% flagged)
- Production timeline differences
- Structure count divergences

- [ ] **Step 4: Review screenshot pairs**

Compare paired screenshots in `docs/m8-comparison/screenshots/`:
- `ts-0000.png` vs `cpp-0000.png` (initial state)
- `ts-0500.png` vs `cpp-0500.png` (early combat)
- `ts-1500.png` vs `cpp-1500.png` (mid-game)
- `ts-2700.png` vs `cpp-2700.png` (end of mission)

Look for: wrong building sprites, missing animations, terrain rendering differences, UI layout differences.

- [ ] **Step 5: Commit the report**

```bash
git add docs/m8-comparison/REPORT.md
git commit -m "docs: M8 dual-runtime comparison report — initial run"
```

- [ ] **Step 6: Deploy**

Run: `cd /Users/discordwell/Projects/CLIaaS && scripts/deploy_vps.sh`
