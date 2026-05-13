/**
 * Dual-runtime check for helicopter Mission_Move -> landing -> Mission_Unload.
 *
 * C++ AircraftClass::Mission_Move switches Status to LAND when the Chinook
 * reaches the LZ, but Process_Landing does not lower Height until the next
 * mission dispatch. If TS descends on the transition tick, the transport lands
 * one tick early and pops queued UNLOAD one tick before C++, consuming the
 * Mission_Unload delay jitter at SCG01EA tick 110 instead of tick 111.
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

const WASM_MISSION_UNLOAD = 15;

interface TransportState {
  cx: number;
  cy: number;
  lx: number;
  ly: number;
  mission: 'UNLOAD' | `MISSION_${number}` | string;
  missionTimer: number;
  navCell: string | null;
  cargo: number;
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

function tsTransport(state: AgentState): TransportState {
  const matches = allTsUnits(state).filter(u => u.t === 'TRAN' && u.h === 'Greece');
  expect(matches).toHaveLength(1);
  const tran = matches[0];
  return {
    cx: tran.cx,
    cy: tran.cy,
    lx: tran.lx!,
    ly: tran.ly!,
    mission: tran.m,
    missionTimer: tran.mt!,
    navCell: tran.mtx === undefined || tran.mty === undefined ? null : `${tran.mtx},${tran.mty}`,
    cargo: tran.cargo ?? 0,
  };
}

function wasmTransport(state: RAGameState): TransportState {
  const matches = allWasmUnits(state).filter(u => u.t === 'TRAN' && u.house === 'Greece');
  expect(matches).toHaveLength(1);
  const tran = matches[0];
  const navCx = cellFromLepton(tran.nlx);
  const navCy = cellFromLepton(tran.nly);
  return {
    cx: tran.cx,
    cy: tran.cy,
    lx: tran.lx!,
    ly: tran.ly!,
    mission: tran.m === WASM_MISSION_UNLOAD ? 'UNLOAD' : `MISSION_${tran.m}`,
    missionTimer: tran.mt!,
    navCell: navCx === undefined || navCy === undefined ? null : `${navCx},${navCy}`,
    cargo: tran.cargo ?? 0,
  };
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG01EA Chinook unload timing', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not begin transport Mission_Unload before C++ landing has fully cleared', async () => {
	    await withDualScenario('SCG01EA', async (handle) => {
	      await handle.ts.syncRngSeed(handle.wasmState.rngState);

	      let observedUnload = false;
	      for (let tick = 1; tick <= 180; tick++) {
	        const result = await stepBoth(handle, 1);
	        const wasmTran = wasmTransport(result.wasm.state);
	        const tsTran = tsTransport(result.ts.state);

	        if (wasmTran.mission !== 'UNLOAD') {
	          expect(tsTran.mission, `TS started UNLOAD before C++ at tick ${tick}`).not.toBe('UNLOAD');
	        } else {
	          observedUnload = true;
	          expect(tsTran).toEqual(wasmTran);
	          break;
	        }
	      }
	      expect(observedUnload).toBe(true);
	    });
	  }, 300_000);
	});
