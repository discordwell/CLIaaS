/**
 * Dual-runtime check for harvester refinery docking.
 *
 * SCG04EA exposes a DriveClass path/facing mismatch on the BadGuy harvester's
 * final approach to its refinery. C++ reaches the dock cell facing west and
 * accepts RADIO_IM_IN on the first Mission_Enter dispatch; TS previously
 * arrived at the same coordinate still facing NW, stayed in Mission_Enter, and
 * consumed the next Mission_Enter jitter instead of the C++ Mission_Unload
 * jitter. The assertion is deliberately behavioral: the harvester must enter
 * UNLOAD on the same dock tick as C++.
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

const WASM_MISSION_ENTER = 8;
const WASM_MISSION_UNLOAD = 15;

interface HarvesterDockState {
  cx: number;
  cy: number;
  lx: number;
  ly: number;
  mission: 'ENTER' | 'UNLOAD' | `MISSION_${number}` | string;
  missionTimer: number;
  driving: boolean;
  navCell: string | null;
}

function allTsUnits(state: AgentState): AgentUnit[] {
  return [...state.units, ...state.enemies];
}

function allWasmUnits(state: RAGameState): RAEntity[] {
  return [...state.units, ...state.enemies];
}

function cellFromLepton(v: number | undefined): number | undefined {
  return v === undefined ? undefined : Math.floor(v / 256);
}

function missionName(mission: number): HarvesterDockState['mission'] {
  if (mission === WASM_MISSION_ENTER) return 'ENTER';
  if (mission === WASM_MISSION_UNLOAD) return 'UNLOAD';
  return `MISSION_${mission}`;
}

function tsHarvester(state: AgentState): HarvesterDockState {
  const matches = allTsUnits(state).filter(u => u.t === 'HARV' && u.h === 'BadGuy');
  expect(matches).toHaveLength(1);
  const harv = matches[0];
  return {
    cx: harv.cx,
    cy: harv.cy,
    lx: harv.lx!,
    ly: harv.ly!,
    mission: harv.m,
    missionTimer: harv.mt!,
    driving: !!harv.drv,
    navCell: harv.mtx === undefined || harv.mty === undefined ? null : `${harv.mtx},${harv.mty}`,
  };
}

function wasmHarvester(state: RAGameState): HarvesterDockState {
  const matches = allWasmUnits(state).filter(u => u.t === 'HARV' && u.house === 'BadGuy');
  expect(matches).toHaveLength(1);
  const harv = matches[0];
  const navCx = cellFromLepton(harv.nlx);
  const navCy = cellFromLepton(harv.nly);
  return {
    cx: harv.cx,
    cy: harv.cy,
    lx: harv.lx!,
    ly: harv.ly!,
    mission: missionName(harv.m),
    missionTimer: harv.mt!,
    driving: !!harv.drv,
    navCell: navCx === undefined || navCy === undefined ? null : `${navCx},${navCy}`,
  };
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG04EA harvester refinery docking', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('enters Mission_Unload on the same refinery docking tick as C++', async () => {
    await withDualScenario('SCG04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState);

      // The docking happens near tick 847. Step close to that point in chunks,
      // then inspect each tick so the failure reports the exact transition.
      await stepBoth(handle, 830);

      let observedUnload = false;
      for (let tick = 831; tick <= 880; tick++) {
        const result = await stepBoth(handle, 1);
        const wasmHarv = wasmHarvester(result.wasm.state);
        const tsHarv = tsHarvester(result.ts.state);

        if (wasmHarv.mission === 'UNLOAD') {
          observedUnload = true;
          expect(tsHarv, `harvester dock state at tick ${tick}`).toEqual(wasmHarv);
          break;
        }

        expect(tsHarv.mission, `TS entered UNLOAD before C++ at tick ${tick}`).not.toBe('UNLOAD');
      }

      expect(observedUnload).toBe(true);
    });
  }, 300_000);
});
