/**
 * SCG05EA's player spy unloads while still completing an infantry driver hop.
 * C++ player move commands call InfantryClass::Assign_Destination, which may
 * Stop_Driver() and clears Path[] before Mission_Move rebuilds Basic_Path.
 * TS must not precompute a replacement path in the command handler, because
 * the still-active Head_To_Coord hop can consume that new path immediately.
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

const WASM_MISSION_GUARD = 5;

interface SpySnapshot {
  cx: number;
  cy: number;
  lx: number;
  ly: number;
  hp: number;
  mission: string;
  driving: boolean;
}

function allTsUnits(state: AgentState): AgentUnit[] {
  return [...state.units, ...state.enemies];
}

function allWasmUnits(state: RAGameState): RAEntity[] {
  return [...state.units, ...state.enemies];
}

function missionName(mission: number): string {
  if (mission === WASM_MISSION_GUARD) return 'GUARD';
  return `MISSION_${mission}`;
}

function tsSpy(state: AgentState): AgentUnit {
  const matches = allTsUnits(state).filter(u => u.t === 'SPY' && u.ally);
  expect(matches).toHaveLength(1);
  return matches[0];
}

function wasmSpy(state: RAGameState): RAEntity {
  const matches = allWasmUnits(state).filter(u => u.t === 'SPY' && u.ally);
  expect(matches).toHaveLength(1);
  return matches[0];
}

function tsSpySnapshot(state: AgentState): SpySnapshot {
  const unit = tsSpy(state);
  return {
    cx: unit.cx,
    cy: unit.cy,
    lx: unit.lx!,
    ly: unit.ly!,
    hp: unit.hp,
    mission: unit.m,
    driving: !!unit.drv,
  };
}

function wasmSpySnapshot(state: RAGameState): SpySnapshot {
  const unit = wasmSpy(state);
  return {
    cx: unit.cx,
    cy: unit.cy,
    lx: unit.lx!,
    ly: unit.ly!,
    hp: unit.hp,
    mission: missionName(unit.m),
    driving: !!unit.drv,
  };
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG05EA spy move-order Stop_Driver', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('matches C++ after replacing an active infantry driver destination twice', async () => {
    await withDualScenario('SCG05EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState);

      let result = await stepBoth(handle, 110);
      const tsInitial = tsSpy(result.ts.state);
      const wasmInitial = wasmSpy(result.wasm.state);

      result = await stepBoth(
        handle,
        10,
        [{ cmd: 'move', unitIds: [tsInitial.id], cx: 18, cy: 48 }],
        [{ cmd: 'move', ids: [wasmInitial.id], cx: 18, cy: 48 }],
      );
      const tsAfterFirst = tsSpy(result.ts.state);
      const wasmAfterFirst = wasmSpy(result.wasm.state);

      result = await stepBoth(
        handle,
        10,
        [{ cmd: 'move', unitIds: [tsAfterFirst.id], cx: 18, cy: 49 }],
        [{ cmd: 'move', ids: [wasmAfterFirst.id], cx: 18, cy: 49 }],
      );

      const wasm = wasmSpySnapshot(result.wasm.state);
      expect(wasm, 'C++ SCG05EA spy state at tick 130').toEqual({
        cx: 16,
        cy: 49,
        lx: 4102,
        ly: 12550,
        hp: 25,
        mission: 'GUARD',
        driving: false,
      });

      expect(tsSpySnapshot(result.ts.state), 'TS SCG05EA spy state at tick 130').toEqual(wasm);
    }, { wasmSeed: 0 });
  }, 300_000);
});
