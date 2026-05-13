/**
 * Dual-runtime check for Mission_Move while an infantry driver is still active.
 *
 * SCG05EA exposes an over-broad TS path-failure short-circuit: a BadGuy E1 has
 * an active Head_To_Coord hop, but its Path[] tail is blocked/exhausted. C++
 * FootClass::Mission_Move still returns Normal_Delay + Random_Pick(0,2), then
 * InfantryClass::Movement_AI advances the active hop later in the same tick.
 * TS must not convert that unit to GUARD before consuming the jitter RNG.
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

interface InfantrySnapshot {
  cx: number;
  cy: number;
  lx: number;
  ly: number;
  mission: string | number;
  missionTimer: number | undefined;
  driving: boolean;
}

function allTsUnits(state: AgentState): AgentUnit[] {
  return [...state.units, ...state.enemies];
}

function allWasmUnits(state: RAGameState): RAEntity[] {
  return [...state.units, ...state.enemies];
}

function wasmBadGuyRifle(state: RAGameState): InfantrySnapshot {
  const matches = allWasmUnits(state).filter(u =>
    u.t === 'E1' &&
    u.house === 'BadGuy' &&
    u.cx >= 35 && u.cx <= 37 &&
    u.cy >= 51 && u.cy <= 53);
  expect(matches).toHaveLength(1);
  const unit = matches[0];
  return {
    cx: unit.cx,
    cy: unit.cy,
    lx: unit.lx!,
    ly: unit.ly!,
    mission: unit.m,
    missionTimer: unit.mt,
    driving: !!unit.drv,
  };
}

function tsBadGuyRifleClosestTo(state: AgentState, reference: InfantrySnapshot): InfantrySnapshot {
  const matches = allTsUnits(state)
    .filter(u => u.t === 'E1' && u.h === 'BadGuy')
    .sort((a, b) => {
      const da = Math.abs((a.lx ?? 0) - reference.lx) + Math.abs((a.ly ?? 0) - reference.ly);
      const db = Math.abs((b.lx ?? 0) - reference.lx) + Math.abs((b.ly ?? 0) - reference.ly);
      return da - db;
    });
  expect(matches.length).toBeGreaterThan(0);
  const unit = matches[0];
  return {
    cx: unit.cx,
    cy: unit.cy,
    lx: unit.lx!,
    ly: unit.ly!,
    mission: unit.m,
    missionTimer: unit.mt,
    driving: !!unit.drv,
  };
}

async function stepBothOneTickAtATime(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  for (let i = 0; i < ticks; i++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG05EA active-driver Mission_Move jitter', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps an active-driver infantry in MOVE and consumes the Mission_Move jitter RNG', async () => {
    await withDualScenario('SCG05EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState);

      const result = await stepBothOneTickAtATime(handle, 412);
      const wasm = wasmBadGuyRifle(result.wasm.state);
      expect(wasm).toEqual({
        cx: 36,
        cy: 52,
        lx: 9374,
        ly: 13434,
        mission: WASM_MISSION_MOVE,
        missionTimer: 14,
        driving: true,
      });

      expect(tsBadGuyRifleClosestTo(result.ts.state, wasm), 'SCG05EA BadGuy E1 state at tick 412').toEqual({
        ...wasm,
        mission: 'MOVE',
      });
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
