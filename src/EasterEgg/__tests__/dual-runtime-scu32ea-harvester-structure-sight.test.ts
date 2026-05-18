/**
 * Dual-runtime check for SCU32EA's opening harvester ore search.
 *
 * C++ loads [UNITS] before [STRUCTURES]. Player units map nearby player-owned
 * structures; those structures receive Revealed(PlayerPtr), call Look(), and
 * make nearby ore legal for UnitClass::Tiberium_Check before the first
 * Mission_Harvest dispatch. TS must reproduce that mapped-cell state instead
 * of relying on agent fog or scenario-specific seed compensation.
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

function wasmUsrrHarvAt(state: RAGameState, cx: number, cy: number): RAEntity {
  const unit = allWasmUnits(state).find(u => u.t === 'HARV' && u.house === 'USSR' && u.cx === cx && u.cy === cy);
  if (!unit) throw new Error(`C++ SCU32EA USSR HARV at (${cx},${cy}) not found`);
  return unit;
}

function tsUsrrHarvAt(state: AgentState, cx: number, cy: number): AgentUnit {
  const unit = allTsUnits(state).find(u => u.t === 'HARV' && u.h === 'USSR' && u.cx === cx && u.cy === cy);
  if (!unit) throw new Error(`TS SCU32EA USSR HARV at (${cx},${cy}) not found`);
  return unit;
}

function tsUnitById(state: AgentState, id: number): AgentUnit {
  const unit = allTsUnits(state).find(u => u.id === id);
  if (!unit) throw new Error(`TS unit ${id} not found`);
  return unit;
}

function wasmUnitById(state: RAGameState, id: number): RAEntity {
  const unit = allWasmUnits(state).find(u => u.id === id);
  if (!unit) throw new Error(`C++ unit ${id} not found`);
  return unit;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU32EA harvester structure sight', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('uses player-owned structure sight so opening harvesters pick the same ore targets', async () => {
    await withDualScenario('SCU32EA', async (handle) => {
      const wasmA0 = wasmUsrrHarvAt(handle.wasmState, 50, 77);
      const wasmB0 = wasmUsrrHarvAt(handle.wasmState, 52, 105);
      const tsA0 = tsUsrrHarvAt(handle.tsState, 50, 77);
      const tsB0 = tsUsrrHarvAt(handle.tsState, 52, 105);
      expect(wasmA0.m).toBe(9);
      expect(wasmB0.m).toBe(9);
      expect(tsA0.m).toBe('HARVEST');
      expect(tsB0.m).toBe('HARVEST');

      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      const result = await stepBoth(handle, 1);

      expect(result.ts.state.tick).toBe(result.wasm.state.tick);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const wasmA = wasmUnitById(result.wasm.state, wasmA0.id) as RAEntity & { ncx?: number; ncy?: number };
      const wasmB = wasmUnitById(result.wasm.state, wasmB0.id) as RAEntity & { ncx?: number; ncy?: number };
      const tsA = tsUnitById(result.ts.state, tsA0.id);
      const tsB = tsUnitById(result.ts.state, tsB0.id);

      expect(tsA.m).toBe('HARVEST');
      expect(tsB.m).toBe('HARVEST');
      expect({ cx: tsA.mtx, cy: tsA.mty }).toEqual({ cx: wasmA.ncx, cy: wasmA.ncy });
      expect({ cx: tsB.mtx, cy: tsB.mty }).toEqual({ cx: wasmB.ncx, cy: wasmB.ncy });
      expect(tsA.mt).toBe(wasmA.mt);
      expect(tsB.mt).toBe(wasmB.mt);
    }, { wasmSeed: 0 });
  }, 240_000);
});
