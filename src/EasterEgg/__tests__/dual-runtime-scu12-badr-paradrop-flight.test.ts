/**
 * Dual-runtime check for fixed-wing aircraft Direction() parity.
 *
 * In SCU12EA, a USSR BADR paradrops five E2s while flying an ATT_WAYPT-style
 * attack run. C++ computes the BADR course with integer Desired_Facing256. An
 * atan-rounded TS heading drifts the aircraft northwest, which moves the later
 * paradropped infantry into the wrong footprint and then changes vehicle
 * pathing through the drop zone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AgentState, AgentUnit } from '../engine/agentHarness.js';
import type { RAEntity, RAGameState } from '../oracle/WasmAdapter.js';
import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type ParityServerHandle,
} from './dual-runtime-test-utils.js';

const serverUp = isDevServerAvailable();
let serverHandle: ParityServerHandle | undefined;

type DropPos = { cx: number; cy: number; lx: number; ly: number };
type BadrState = { cx: number; cy: number; lx: number; ly: number; cargo: number | undefined; mission: number | string; timer: number | undefined };

function sortDropPositions(rows: DropPos[]): DropPos[] {
  return [...rows].sort((a, b) => (a.ly - b.ly) || (a.lx - b.lx) || (a.cx - b.cx) || (a.cy - b.cy));
}

function tsUnits(state: AgentState): AgentUnit[] {
  return [...state.units, ...state.enemies];
}

function wasmUnits(state: RAGameState): RAEntity[] {
  return [...state.units, ...state.enemies];
}

function tsParadroppedE2s(state: AgentState): DropPos[] {
  return sortDropPositions(tsUnits(state)
    .filter(u => u.t === 'E2' && (u.lx ?? 0) >= 8800 && (u.lx ?? 0) <= 9700 && (u.ly ?? 0) >= 9800 && (u.ly ?? 0) <= 10900)
    .map(u => ({ cx: u.cx, cy: u.cy, lx: u.lx!, ly: u.ly! })));
}

function wasmParadroppedE2s(state: RAGameState): DropPos[] {
  return sortDropPositions(wasmUnits(state)
    .filter(u => u.t === 'E2' && (u.lx ?? 0) >= 8800 && (u.lx ?? 0) <= 9700 && (u.ly ?? 0) >= 9800 && (u.ly ?? 0) <= 10900)
    .map(u => ({ cx: u.cx, cy: u.cy, lx: u.lx!, ly: u.ly! })));
}

function tsBadr(state: AgentState): BadrState {
  const badr = tsUnits(state).find(u => u.t === 'BADR' && u.h === 'USSR');
  expect(badr, 'TS SCU12 BADR').toBeDefined();
  return { cx: badr!.cx, cy: badr!.cy, lx: badr!.lx!, ly: badr!.ly!, cargo: badr!.cargo, mission: badr!.m, timer: badr!.mt };
}

function wasmBadr(state: RAGameState): BadrState {
  const badr = wasmUnits(state).find(u => u.t === 'BADR' && u.house === 'USSR');
  expect(badr, 'C++ SCU12 BADR').toBeDefined();
  return { cx: badr!.cx, cy: badr!.cy, lx: badr!.lx!, ly: badr!.ly!, cargo: badr!.cargo, mission: badr!.m, timer: badr!.mt };
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU12 BADR paradrop flight path', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('drops the five E2 passengers into the same footprint as C++', async () => {
    await withDualScenario('SCU12EA', async (handle) => {
      // This test isolates fixed-wing paradrop behavior, not scenario init RNG
      // parity. Use the live C++ seed after both runtimes load instead of any
      // hardcoded mission seed table.
      await handle.ts.syncRngSeed(handle.wasmState.rngState);

      let result = await stepBoth(handle, 120);
      for (let tick = 121; tick <= 240; tick++) {
        const wasmDrops = wasmParadroppedE2s(result.wasm.state);
        const tsDrops = tsParadroppedE2s(result.ts.state);
        if (wasmDrops.length >= 5 && tsDrops.length >= 5) break;
        result = await stepBoth(handle, 1);
      }

      const wasmDrops = wasmParadroppedE2s(result.wasm.state);
      const tsDrops = tsParadroppedE2s(result.ts.state);

      expect(wasmDrops).toHaveLength(5);
      expect(tsDrops).toEqual(wasmDrops);
    }, { wasmSeed: 0 });
  }, 300_000);

  it('reattaches cargo when C++ rejects a paradrop into an enemy-occupied cell', async () => {
    await withDualScenario('SCU12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState);

      const result = await stepBoth(handle, 159);

      expect(tsBadr(result.ts.state)).toEqual({
        ...wasmBadr(result.wasm.state),
        mission: 'ATTACK',
      });
      expect(wasmParadroppedE2s(result.wasm.state)).toHaveLength(4);
      expect(tsParadroppedE2s(result.ts.state)).toEqual(wasmParadroppedE2s(result.wasm.state));

      const afterRangeExit = await stepBoth(handle, 3);
      expect(tsBadr(afterRangeExit.ts.state)).toEqual({
        ...wasmBadr(afterRangeExit.wasm.state),
        mission: 'ATTACK',
      });
    }, { wasmSeed: 3 });
  }, 300_000);
});
