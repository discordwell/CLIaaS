/**
 * Dual-runtime check for SCU34EA's invalid global-30 trigger.
 *
 * C++ TEVENT_GLOBAL_SET/CLEAR reads Scen.GlobalFlags[Data.Value] without the
 * bounds guard used by Set_Global_To. Since GlobalFlags has 30 entries,
 * index 30 aliases Scen.Views[0]'s low byte. SCU34EA's civ4 trigger uses that
 * alias to create the opening help/hel1 teams; TS must model the C++ memory
 * behavior instead of treating the invalid index as false.
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

function aircraftAtEdge(state: RAGameState): RAEntity[] {
  return allWasmUnits(state)
    .filter(u => (u.t === 'MIG' || u.t === 'HELI') && u.house === 'Greece' && u.cx === 30 && u.cy === 116)
    .sort((a, b) => a.t.localeCompare(b.t));
}

function tsAircraftAtEdge(state: AgentState): AgentUnit[] {
  return allTsUnits(state)
    .filter(u => (u.t === 'MIG' || u.t === 'HELI') && u.h === 'Greece' && u.cx === 30 && u.cy === 116)
    .sort((a, b) => a.t.localeCompare(b.t));
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU34EA global-30 view alias', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('fires the opening civ4 GLOBAL_SET(30) trigger and creates the hel1 team', async () => {
    await withDualScenario('SCU34EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      const result = await stepBoth(handle, 1);

      expect(result.ts.state.tick).toBe(result.wasm.state.tick);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const wasmEdgeAircraft = aircraftAtEdge(result.wasm.state);
      const tsEdgeAircraft = tsAircraftAtEdge(result.ts.state);

      expect(wasmEdgeAircraft.map(u => u.t)).toEqual(['HELI', 'HELI', 'MIG']);
      expect(tsEdgeAircraft.map(u => u.t)).toEqual(['HELI', 'HELI', 'MIG']);
    }, { wasmSeed: 0 });
  }, 240_000);
});
