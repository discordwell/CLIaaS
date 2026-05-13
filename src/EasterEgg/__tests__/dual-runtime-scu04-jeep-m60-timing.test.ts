/**
 * Dual-runtime check for UnitClass::IsRotating firing gate timing.
 *
 * In SCU04EA, the Greek JEEP at (84,83) tracks a drifting Soviet 3TNK at
 * (85,86). C++ Can_Fire reads UnitClass::IsRotating as left by the previous
 * Rotation_AI pass, so the M60 shot fires on tick 8. TS used to recompute
 * "rotating" from the newly refreshed desired turret facing, delaying the shot
 * by one frame and moving the invisible-bullet scatter RNG call to tick 9.
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

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU04EA Jeep M60 firing timing', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('fires the Greek Jeep M60 on the same tick as C++ while tracking a moving tank', async () => {
    await withDualScenario('SCU04EA', async (handle) => {
      const tick8 = await stepBoth(handle, 8);

      const tsJeep = tsUnitAt(tick8.ts.state, 'Greece', 'JEEP', 84, 83);
      const wasmJeep = wasmUnitAt(tick8.wasm.state, 'Greece', 'JEEP', 84, 83);
      const tsTarget = tsUnitAt(tick8.ts.state, 'USSR', '3TNK', 85, 86);
      const wasmTarget = wasmUnitAt(tick8.wasm.state, 'USSR', '3TNK', 85, 86);

      expect(wasmJeep.arm).toBeGreaterThan(0);
      expect(tsJeep.acd ?? 0).toBe(wasmJeep.arm);
      expect(tsTarget.hp).toBe(wasmTarget.hp);
      expect(wasmTarget.hp).toBeLessThan(wasmTarget.mhp);
    });
  }, 300_000);
});
