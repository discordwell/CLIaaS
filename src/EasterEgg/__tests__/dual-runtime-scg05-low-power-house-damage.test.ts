/**
 * Dual-runtime check for HouseClass low-power building damage.
 *
 * SCG05EA gives BadGuy power-consuming structures but no power production.
 * C++ HouseClass::AI starts DamageTime at Rule.DamageDelay (one minute), so
 * tick 901 applies one AP damage point to every above-yellow BadGuy building
 * with Class->Drain. The damaged rebuildable barracks then seeds RepairTimer
 * on the next BuildingClass::Repair_AI pass, which is the tick-902 RNG branch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AgentState, AgentStructure } from '../engine/agentHarness.js';
import type { RAGameState, RAStructure } from '../oracle/WasmAdapter.js';
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

function wasmStructure(
  state: RAGameState,
  type: string,
  house: string,
  cx: number,
  cy: number,
): RAStructure {
  const structure = state.structures.find(s =>
    s.t === type &&
    s.house === house &&
    s.cx === cx &&
    s.cy === cy);
  expect(structure, `C++ ${house} ${type} at (${cx},${cy})`).toBeDefined();
  return structure!;
}

function tsStructure(
  state: AgentState,
  type: string,
  house: string,
  cx: number,
  cy: number,
): AgentStructure {
  const structure = state.structures.find(s =>
    s.t === type &&
    s.h === house &&
    s.cx === cx &&
    s.cy === cy);
  expect(structure, `TS ${house} ${type} at (${cx},${cy})`).toBeDefined();
  return structure!;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG05EA low-power house damage', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('damages BadGuy draining structures when their house has no power', async () => {
    await withDualScenario('SCG05EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 900);
      let result = await stepBoth(handle, 1);

      expect(wasmStructure(result.wasm.state, 'WEAP', 'BadGuy', 44, 50).hp).toBe(999);
      expect(wasmStructure(result.wasm.state, 'BARR', 'BadGuy', 56, 83).hp).toBe(799);
      expect(wasmStructure(result.wasm.state, 'BARR', 'BadGuy', 27, 81).hp).toBe(799);

      expect(tsStructure(result.ts.state, 'WEAP', 'BadGuy', 44, 50).hp).toBe(999);
      expect(tsStructure(result.ts.state, 'BARR', 'BadGuy', 56, 83).hp).toBe(799);
      expect(tsStructure(result.ts.state, 'BARR', 'BadGuy', 27, 81).hp).toBe(799);

      result = await stepBoth(handle, 1);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
