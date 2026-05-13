/**
 * Dual-runtime check for DriveClass::Start_Of_Move blocked-track behavior.
 *
 * SCG05EA's Soviet harvester reaches cell (61,76) while still targeting ore at
 * (59,76). C++ Can_Enter_Cell can reject the next path cell, but for
 * MISSION_HARVEST Start_Of_Move only clears Path[0]; it keeps NavCom legal so
 * the next Basic_Path retry continues toward the same ore patch. Clearing the
 * TS move target here makes the harvester retarget ore and later adds a bogus
 * harvest-delay RNG call.
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

function wasmHarvesterAt(state: RAGameState, cx: number, cy: number): RAEntity {
  const harvester = allWasmUnits(state).find(u => u.t === 'HARV' && u.cx === cx && u.cy === cy);
  expect(harvester, `C++ HARV at (${cx},${cy})`).toBeDefined();
  return harvester!;
}

function tsHarvesterAt(state: AgentState, cx: number, cy: number): AgentUnit {
  const harvester = allTsUnits(state).find(u => u.t === 'HARV' && u.cx === cx && u.cy === cy);
  expect(harvester, `TS HARV at (${cx},${cy})`).toBeDefined();
  return harvester!;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG05EA harvester NavCom retention', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the harvest NavCom after a blocked track-start retry', async () => {
    await withDualScenario('SCG05EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBoth(handle, 457);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      result = await stepBoth(handle, 1);

      const cppHarvester = wasmHarvesterAt(result.wasm.state, 61, 76);
      expect(cppHarvester.nlx, 'C++ HARV still has ore NavCom X').toBeDefined();
      expect(cppHarvester.nly, 'C++ HARV still has ore NavCom Y').toBeDefined();
      expect(Math.floor(cppHarvester.nlx! / 256)).toBe(59);
      expect(Math.floor(cppHarvester.nly! / 256)).toBe(76);

      expect(tsHarvesterAt(result.ts.state, 61, 76)).toMatchObject({
        m: 'HARVEST',
        mtx: 59,
        mty: 76,
      });
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
