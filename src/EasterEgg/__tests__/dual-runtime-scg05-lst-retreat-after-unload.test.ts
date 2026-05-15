/**
 * SCG05EA starts with a loaner LST that carries the spy to shore. C++
 * VesselClass::Mission_Unload does not delete the LST when the cargo exits;
 * once the door closes it assigns MISSION_RETREAT and the vessel sails toward
 * the calculated edge cell. TS must keep the transport alive on that retreat
 * path instead of treating the current in-bounds edge cell as an immediate map
 * exit.
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

const WASM_MISSION_RETREAT = 4;

interface LstSnapshot {
  cx: number;
  cy: number;
  lx: number;
  ly: number;
  mission: 'RETREAT' | `MISSION_${number}` | string;
  missionTimer: number;
  cargo: number;
  driving: boolean;
}

function allTsUnits(state: AgentState): AgentUnit[] {
  return [...state.units, ...state.enemies];
}

function allWasmUnits(state: RAGameState): RAEntity[] {
  return [...state.units, ...state.enemies];
}

function missionName(mission: number): LstSnapshot['mission'] {
  if (mission === WASM_MISSION_RETREAT) return 'RETREAT';
  return `MISSION_${mission}`;
}

function tsLst(state: AgentState): LstSnapshot | undefined {
  const unit = allTsUnits(state).find(u => u.t === 'LST');
  if (!unit) return undefined;
  return {
    cx: unit.cx,
    cy: unit.cy,
    lx: unit.lx!,
    ly: unit.ly!,
    mission: unit.m,
    missionTimer: unit.mt!,
    cargo: unit.cargo ?? 0,
    driving: unit.drv ?? false,
  };
}

function wasmLst(state: RAGameState): LstSnapshot | undefined {
  const unit = allWasmUnits(state).find(u => u.t === 'LST');
  if (!unit) return undefined;
  return {
    cx: unit.cx,
    cy: unit.cy,
    lx: unit.lx!,
    ly: unit.ly!,
    mission: missionName(unit.m),
    missionTimer: unit.mt!,
    cargo: unit.cargo ?? 0,
    driving: unit.drv ?? false,
  };
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG05EA LST retreat after unload', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the empty loaner LST alive on MISSION_RETREAT after the spy unloads', async () => {
    await withDualScenario('SCG05EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState);

      let elapsed = 0;
      let lastWasm: LstSnapshot | undefined;
      for (const checkpoint of [120, 200, 288, 295]) {
        const result = await stepBoth(handle, checkpoint - elapsed);
        elapsed = checkpoint;
        const wasm = wasmLst(result.wasm.state);
        const ts = tsLst(result.ts.state);
        lastWasm = wasm;

        expect(ts, `TS LST should match C++ at tick ${checkpoint}`).toEqual(wasm);
      }

      expect(lastWasm, 'C++ LST should have started retreating by tick 295').toMatchObject({
        cx: 14,
        cy: 48,
        mission: 'RETREAT',
        cargo: 0,
        driving: true,
      });
    });
  }, 300_000);
});
