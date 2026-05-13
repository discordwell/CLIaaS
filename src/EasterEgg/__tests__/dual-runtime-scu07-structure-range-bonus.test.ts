/**
 * Dual-runtime check for TechnoClass::In_Range against buildings.
 *
 * C++ adds `(building width + building height) * 64` leptons to weapon range
 * when TarCom is a BuildingClass, and measures from Fire_Coord(). In SCU07EA,
 * the Greek E1 at (99,53) can fire on the USSR BRL3 at (98,50) because that
 * 1x1 building bonus plus the infantry muzzle offset puts the target in range.
 * TS used to measure from the infantry center in updateAttackStructure, kept
 * walking, and missed the tick-56 barrel-destruction cascade.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AgentState, AgentStructure, AgentUnit } from '../engine/agentHarness.js';
import type { RAEntity, RAGameState, RAStructure } from '../oracle/WasmAdapter.js';
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

type WasmEntityWithArm = RAEntity & { arm?: number };

function tsUnits(state: AgentState): AgentUnit[] {
  return [...state.units, ...state.enemies];
}

function wasmUnits(state: RAGameState): WasmEntityWithArm[] {
  return [...state.units, ...state.enemies] as WasmEntityWithArm[];
}

function tsUnitAt(state: AgentState, house: string, type: string, cx: number, cy: number): AgentUnit {
  const matches = tsUnits(state).filter(u => u.h === house && u.t === type && u.cx === cx && u.cy === cy);
  expect(matches).toHaveLength(1);
  return matches[0];
}

function wasmUnitAt(state: RAGameState, house: string, type: string, cx: number, cy: number): WasmEntityWithArm {
  const matches = wasmUnits(state).filter(u => u.house === house && u.t === type && u.cx === cx && u.cy === cy);
  expect(matches).toHaveLength(1);
  return matches[0];
}

function tsStructureAt(state: AgentState, house: string, type: string, cx: number, cy: number): AgentStructure | undefined {
  return state.structures.find(s => s.h === house && s.t === type && s.cx === cx && s.cy === cy);
}

function wasmStructureAt(state: RAGameState, house: string, type: string, cx: number, cy: number): RAStructure | undefined {
  return state.structures.find(s => s.house === house && s.t === type && s.cx === cx && s.cy === cy);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU07EA building range bonus', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('fires the Greek E1 at the BRL3 once Fire_Coord plus building bonus is in range', async () => {
    await withDualScenario('SCU07EA', async (handle) => {
      const tick56 = await stepBoth(handle, 56);

      const tsRifle = tsUnitAt(tick56.ts.state, 'Greece', 'E1', 99, 53);
      const wasmRifle = wasmUnitAt(tick56.wasm.state, 'Greece', 'E1', 99, 53);

      expect(wasmRifle.arm).toBeGreaterThan(0);
      expect(tsRifle.acd ?? 0).toBe(wasmRifle.arm);
      expect(wasmStructureAt(tick56.wasm.state, 'USSR', 'BRL3', 98, 50)).toBeUndefined();
      expect(tsStructureAt(tick56.ts.state, 'USSR', 'BRL3', 98, 50)).toBeUndefined();
    });
  }, 300_000);

  it('stops the structure approach path through FootClass per-cell range checks', async () => {
    await withDualScenario('SCU07EA', async (handle) => {
      const tick67 = await stepBoth(handle, 67);

      const tsRifle = tsUnitAt(tick67.ts.state, 'Greece', 'E1', 99, 53);
      const wasmRifle = wasmUnitAt(tick67.wasm.state, 'Greece', 'E1', 99, 53);

      expect(wasmRifle.m).toBe(14); // MISSION_HUNT
      expect(tsRifle.m).toBe('HUNT');
      expect(tsRifle.lx).toBe(wasmRifle.lx);
      expect(tsRifle.ly).toBe(wasmRifle.ly);
      expect(tsRifle.drv).toBe(wasmRifle.drv);
      expect(tsRifle.acd ?? 0).toBe(wasmRifle.arm);
    });
  }, 300_000);
});
