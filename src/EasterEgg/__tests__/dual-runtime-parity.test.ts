/**
 * E2E test — requires `pnpm dev` running on port 3001.
 * Runs C++ WASM alongside the TS engine in Playwright browsers.
 * Use `pnpm test:e2e` to run. Skips gracefully via skipIf(!serverUp) in `pnpm test`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AgentState, AgentUnit } from '../engine/agentHarness.js';
import type { RAGameState, RAEntity } from '../oracle/WasmAdapter.js';
import {
  ensureParityServer,
  isDevServerAvailable,
  stopParityServer,
  stepBoth,
  withDualScenario,
  type ParityServerHandle,
} from './dual-runtime-test-utils.js';

const serverUp = isDevServerAvailable();

let serverHandle: ParityServerHandle | undefined;

function singleTsUnit(
  state: AgentState,
  type: string,
  predicate: (unit: AgentUnit) => boolean = () => true,
): AgentUnit {
  const matches = state.units.filter((unit) => unit.t === type && predicate(unit));
  expect(matches, `expected exactly one allied ${type} in TS state`).toHaveLength(1);
  return matches[0];
}

function singleWasmUnit(
  state: RAGameState,
  type: string,
  predicate: (unit: RAEntity) => boolean = () => true,
): RAEntity {
  const matches = state.units.filter((unit) => unit.t === type && predicate(unit));
  expect(matches, `expected exactly one allied ${type} in C++ state`).toHaveLength(1);
  return matches[0];
}

function topLeftUnit<T extends { t: string; cx: number; cy: number; id: number }>(
  units: T[],
  type: string,
): T {
  const match = units
    .filter(unit => unit.t === type)
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx || a.id - b.id)[0];
  expect(match, `expected at least one ${type}`).toBeDefined();
  return match;
}

function hasAlliedStructure(state: AgentState | RAGameState, type: string): boolean {
  return state.structures.some((structure) => structure.ally && structure.t === type);
}

function isPlacementReadyForPowr(state: AgentState | RAGameState): boolean {
  if ('pending' in state) {
    return state.pending === 'POWR';
  }
  return state.production?.some((item) => item.t === 'POWR' && item.done === true) ?? false;
}

describe.skipIf(!serverUp)('Dual Runtime Parity', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);
  it('keeps the SCA01EA jeep move/stop sequence in lock-step', async () => {
    await withDualScenario('SCA01EA', async (handle) => {
      const tsJeep = singleTsUnit(handle.tsState, 'JEEP');
      const wasmJeep = singleWasmUnit(handle.wasmState, 'JEEP');

      // 180 ticks gives the jeep enough time to reliably reach the target cell;
      // 120 was borderline and caused flaky failures (jeep 2 cells short).
      const moved = await stepBoth(
        handle,
        180,
        [{ cmd: 'move', unitIds: [tsJeep.id], cx: 45, cy: 84 }],
        [{ cmd: 'move', ids: [wasmJeep.id], cx: 45, cy: 84 }],
      );
      const tsMovedJeep = singleTsUnit(moved.ts.state, 'JEEP');
      const wasmMovedJeep = singleWasmUnit(moved.wasm.state, 'JEEP');
      expect(tsMovedJeep.cx).toBe(45);
      expect(tsMovedJeep.cy).toBe(84);
      expect(wasmMovedJeep.cx).toBe(45);
      expect(wasmMovedJeep.cy).toBe(84);
      expect(tsMovedJeep.hp).toBe(wasmMovedJeep.hp);

      const stopped = await stepBoth(
        handle,
        45,
        [{ cmd: 'stop', unitIds: [tsJeep.id] }],
        [{ cmd: 'stop', ids: [wasmJeep.id] }],
      );
      const tsStoppedJeep = singleTsUnit(stopped.ts.state, 'JEEP');
      const wasmStoppedJeep = singleWasmUnit(stopped.wasm.state, 'JEEP');
      expect(tsStoppedJeep.cx).toBe(45);
      expect(tsStoppedJeep.cy).toBe(84);
      expect(wasmStoppedJeep.cx).toBe(45);
      expect(wasmStoppedJeep.cy).toBe(84);
      expect(tsStoppedJeep.hp).toBe(wasmStoppedJeep.hp);
    });
  }, 300_000);

  it('keeps SCG01EA stop command from clearing a rearming JEEP target', async () => {
    await withDualScenario('SCG01EA', async (handle) => {
      const idle = await stepBoth(handle, 60);
      const tsMoveJeep = topLeftUnit(idle.ts.state.units, 'JEEP');
      const wasmMoveJeep = topLeftUnit(idle.wasm.state.units, 'JEEP');

      const moved = await stepBoth(
        handle,
        120,
        [{ cmd: 'move', unitIds: [tsMoveJeep.id], cx: 45, cy: 84 }],
        [{ cmd: 'move', ids: [wasmMoveJeep.id], cx: 45, cy: 84 }],
      );
      const tsStopJeep = topLeftUnit(moved.ts.state.units, 'JEEP');
      const wasmStopJeep = topLeftUnit(moved.wasm.state.units, 'JEEP');

      const stopped = await stepBoth(
        handle,
        1,
        [{ cmd: 'stop', unitIds: [tsStopJeep.id] }],
        [{ cmd: 'stop', ids: [wasmStopJeep.id] }],
      );

      const tsAfter = stopped.ts.state.units.find(unit => unit.id === tsStopJeep.id);
      const wasmAfter = stopped.wasm.state.units.find(unit => unit.id === wasmStopJeep.id) as
        | (RAEntity & { tlx?: number; tly?: number })
        | undefined;
      expect(tsAfter).toBeDefined();
      expect(wasmAfter).toBeDefined();
      expect(wasmAfter?.tlx, 'C++ stop preserves TarCom target x').toBeGreaterThan(0);
      expect(wasmAfter?.tly, 'C++ stop preserves TarCom target y').toBeGreaterThan(0);
      expect(tsAfter?.tid, 'TS stop must preserve TarCom like Assign_Mission(GUARD)').toBeDefined();

      const tsTarget = stopped.ts.state.enemies.find(unit => unit.id === tsAfter!.tid);
      expect(tsTarget, 'TS preserved target remains alive').toBeDefined();
      expect(tsTarget?.t).toBe('E1');
      expect(tsTarget?.cx).toBe(Math.floor((wasmAfter!.tlx ?? 0) / 256));
      expect(tsTarget?.cy).toBe(Math.floor((wasmAfter!.tly ?? 0) / 256));
    });
  }, 300_000);

  it('does not instantly load adjacent infantry into the APC in both runtimes', async () => {
    await withDualScenario('SCG22EA', async (handle) => {
      const tsApc = singleTsUnit(handle.tsState, 'APC');
      const wasmApc = singleWasmUnit(handle.wasmState, 'APC');
      const tsSpy = singleTsUnit(handle.tsState, 'SPY');
      const wasmSpy = singleWasmUnit(handle.wasmState, 'SPY');

      const result = await stepBoth(
        handle,
        1,
        [{ cmd: 'enter', unitId: tsSpy.id, transportId: tsApc.id }],
        [{ cmd: 'enter', ids: [wasmSpy.id], target: wasmApc.id }],
      );

      const tsLoadedApc = singleTsUnit(result.ts.state, 'APC');
      const wasmLoadedApc = singleWasmUnit(result.wasm.state, 'APC');

      expect(tsLoadedApc.cargo).toBe(0);
      expect(wasmLoadedApc.cargo).toBe(0);

      expect(result.ts.state.units.some((unit) => unit.t === 'SPY')).toBe(true);
      expect(result.wasm.state.units.some((unit) => unit.t === 'SPY')).toBe(true);
    });
  }, 300_000);

  it('deploys the starting MCV into a FACT in both runtimes', async () => {
    await withDualScenario('SCG28EA', async (handle) => {
      const tsMcv = singleTsUnit(handle.tsState, 'MCV');
      const wasmMcv = singleWasmUnit(handle.wasmState, 'MCV');

      const result = await stepBoth(
        handle,
        90,
        [{ cmd: 'deploy', unitId: tsMcv.id }],
        [{ cmd: 'deploy', ids: [wasmMcv.id] }],
      );

      expect(result.ts.state.units.some((unit) => unit.t === 'MCV')).toBe(false);
      expect(result.wasm.state.units.some((unit) => unit.t === 'MCV')).toBe(false);

      expect(hasAlliedStructure(result.ts.state, 'FACT')).toBe(true);
      expect(hasAlliedStructure(result.wasm.state, 'FACT')).toBe(true);
    });
  }, 300_000);

  it('reaches a placement-ready POWR state after deploy + production in both runtimes', async () => {
    await withDualScenario('SCU05EA', async (handle) => {
      const tsMcv = singleTsUnit(handle.tsState, 'MCV', (unit) => unit.h === handle.tsState.playerHouse);
      const wasmMcv = singleWasmUnit(handle.wasmState, 'MCV', (unit) => unit.house === handle.wasmState.playerHouse);

      const deployed = await stepBoth(
        handle,
        90,
        [{ cmd: 'deploy', unitId: tsMcv.id }],
        [{ cmd: 'deploy', ids: [wasmMcv.id] }],
      );

      expect(hasAlliedStructure(deployed.ts.state, 'FACT')).toBe(true);
      expect(hasAlliedStructure(deployed.wasm.state, 'FACT')).toBe(true);

      const started = await stepBoth(
        handle,
        1,
        [{ cmd: 'build', type: 'POWR' }],
        [{ cmd: 'produce', rtti: 6, type_id: 17 }],
      );

      const completed = await stepBoth(handle, 300);

      expect(completed.ts.state.credits).toBeLessThan(deployed.ts.state.credits);
      expect(completed.wasm.state.credits).toBeLessThan(deployed.wasm.state.credits);
      expect(isPlacementReadyForPowr(completed.ts.state)).toBe(true);
      expect(isPlacementReadyForPowr(completed.wasm.state)).toBe(true);
    });
  }, 300_000);
});
