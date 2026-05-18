/**
 * Dual-runtime check for InfantryClass::Movement_AI close-enough path abort.
 *
 * In SCG02EA, two Greek E1s stop near a crowded destination at cell (87,49).
 * C++ validates the next Path[0] before Start_Driver; when Can_Enter_Cell
 * rejects that next cell, Basic_Path can still return the same adjacent cell.
 * C++ then validates that freshly selected acell, clears NavCom when the
 * infantry is already within CloseEnoughDistance, and stops the driver. Leaving
 * TS moveTarget alive delays the MOVE->GUARD transition and misses the
 * tick-1068 guard RNG.
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

function allTsUnits(state: AgentState): AgentUnit[] {
  return [...state.units, ...state.enemies];
}

function allWasmUnits(state: RAGameState): RAEntity[] {
  return [...state.units, ...state.enemies];
}

function wasmGreekE1AtLepton(state: RAGameState, lx: number, ly: number): RAEntity {
  const unit = allWasmUnits(state).find(u =>
    u.t === 'E1' &&
    u.house === 'Greece' &&
    u.lx === lx &&
    u.ly === ly);
  expect(unit, `C++ Greece E1 at lepton (${lx},${ly})`).toBeDefined();
  return unit!;
}

function tsGreekE1AtLepton(state: AgentState, lx: number, ly: number): AgentUnit {
  const unit = allTsUnits(state).find(u =>
    u.t === 'E1' &&
    u.h === 'Greece' &&
    u.lx === lx &&
    u.ly === ly);
  expect(unit, `TS Greece E1 at lepton (${lx},${ly})`).toBeDefined();
  return unit!;
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

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG02EA infantry blocked close-enough path', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('clears MOVE NavCom when the next infantry path cell is blocked close to destination', async () => {
    await withDualScenario('SCG02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothOneTickAtATime(handle, 1066);

      const cppNorth = wasmGreekE1AtLepton(result.wasm.state, 22464, 12352);
      const cppWest = wasmGreekE1AtLepton(result.wasm.state, 22400, 12416);
      expect(cppNorth.nlx).toBeUndefined();
      expect(cppNorth.nly).toBeUndefined();
      expect(cppWest.nlx).toBeUndefined();
      expect(cppWest.nly).toBeUndefined();

      const tsNorth = tsGreekE1AtLepton(result.ts.state, 22464, 12352);
      const tsWest = tsGreekE1AtLepton(result.ts.state, 22400, 12416);
      expect(tsNorth.mtx).toBeUndefined();
      expect(tsNorth.mty).toBeUndefined();
      expect(tsWest.mtx).toBeUndefined();
      expect(tsWest.mty).toBeUndefined();

      result = await stepBothOneTickAtATime(handle, 2);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
