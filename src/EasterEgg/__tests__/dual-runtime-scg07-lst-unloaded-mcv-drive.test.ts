/**
 * Dual-runtime check for LST cargo DriveClass startup.
 *
 * C++ vessel.cpp detaches LST cargo, calls Assign_Destination() for the
 * adjacent ramp cell, and DriveClass::Assign_Destination immediately enters
 * Start_Of_Move() for non-driving drive-class passengers. SCG07EA exposes the
 * difference: if TS only records NavCom, DriveClass::AI clears the cross-zone
 * ramp destination before movement starts, consumes UnitClass::IsToScatter, and
 * the Greek MCV idles/scatters instead of driving off the landing craft.
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

interface RampMcvState {
  cx: number;
  cy: number;
  lx: number;
  ly: number;
  mission: 'MOVE' | `MISSION_${number}` | string;
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

function tsRampMcv(state: AgentState): RampMcvState {
  const matches = allTsUnits(state).filter(u =>
    u.t === 'MCV' && u.h === 'Greece' && u.cy >= 57 && u.cy <= 58);
  expect(matches).toHaveLength(1);
  const mcv = matches[0];
  return {
    cx: mcv.cx,
    cy: mcv.cy,
    lx: mcv.lx!,
    ly: mcv.ly!,
    mission: mcv.m,
    driving: !!mcv.drv,
    navCell: mcv.mtx === undefined || mcv.mty === undefined ? null : `${mcv.mtx},${mcv.mty}`,
  };
}

function wasmRampMcv(state: RAGameState): RampMcvState {
  const matches = allWasmUnits(state).filter(u =>
    u.t === 'MCV' && u.house === 'Greece' && u.cy >= 57 && u.cy <= 58);
  expect(matches).toHaveLength(1);
  const mcv = matches[0];
  const navCx = cellFromLepton(mcv.nlx);
  const navCy = cellFromLepton(mcv.nly);
  return {
    cx: mcv.cx,
    cy: mcv.cy,
    lx: mcv.lx!,
    ly: mcv.ly!,
    mission: mcv.m === WASM_MISSION_MOVE ? 'MOVE' : `MISSION_${mcv.m}`,
    driving: !!mcv.drv,
    navCell: navCx === undefined || navCy === undefined ? null : `${navCx},${navCy}`,
  };
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG07EA LST-unloaded MCV drive startup', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('starts the detached MCV driving toward the ramp cell before IsToScatter can redirect it', async () => {
    await withDualScenario('SCG07EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState);

      const result = await stepBoth(handle, 287);

      const wasmMcv = wasmRampMcv(result.wasm.state);
      const tsMcv = tsRampMcv(result.ts.state);

      expect(wasmMcv.mission).toBe('MOVE');
      expect(wasmMcv.driving).toBe(true);
      expect(tsMcv).toEqual(wasmMcv);
    });
  }, 300_000);
});
