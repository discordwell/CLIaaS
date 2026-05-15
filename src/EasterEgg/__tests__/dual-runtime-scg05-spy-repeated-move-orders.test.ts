/**
 * SCG05EA's oracle keeps clicking the spy toward the same route cells while
 * dogs patrol the corridor. C++ does not dedupe those clicks: each command
 * calls InfantryClass::Assign_Destination and can Stop_Driver/rebuild Path[].
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

const WASM_MISSION_MOVE = 2;

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
  if (mission === WASM_MISSION_MOVE) return 'MOVE';
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

function routeFromWasmSpy(spy: RAEntity): { cx: number; cy: number } {
  if (spy.cx < 18) return { cx: 18, cy: spy.cy };
  if (spy.cy > 48 && spy.cx < 20) return { cx: spy.cx, cy: 48 };
  return { cx: 43, cy: 48 };
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

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG05EA repeated spy move orders', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the spy synchronized when repeated clicks reset the infantry driver path', async () => {
    await withDualScenario('SCG05EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState);

      let result = await stepBoth(handle, 110);
      for (let tick = 120; tick <= 300; tick += 10) {
        const ts = tsSpy(result.ts.state);
        const wasm = wasmSpy(result.wasm.state);
        const dest = routeFromWasmSpy(wasm);

        result = await stepBoth(
          handle,
          10,
          [{ cmd: 'move', unitIds: [ts.id], ...dest }],
          [{ cmd: 'move', ids: [wasm.id], ...dest }],
        );
      }

      const wasm = wasmSpySnapshot(result.wasm.state);
      expect(wasm, 'C++ SCG05EA spy state at tick 300').toEqual({
        cx: 21,
        cy: 48,
        lx: 5392,
        ly: 12485,
        hp: 25,
        mission: 'MOVE',
        driving: true,
      });

      expect(tsSpySnapshot(result.ts.state), 'TS SCG05EA spy state at tick 300').toEqual(wasm);
    }, { wasmSeed: 0 });
  }, 300_000);
});
