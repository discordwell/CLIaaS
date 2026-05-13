/**
 * Dual-runtime check for TechnoClass::AI cloak ordering.
 *
 * In SCU11EA, the Soviet SS at (67,101) starts AREA_GUARD and has no TarCom
 * in the initial observed state. C++ runs MissionClass::AI through
 * RadioClass::AI before Cloaking_AI, so AREA_GUARD acquires the nearby Greek
 * DD before Is_Ready_To_Cloak() evaluates. The sub stays UNCLOAKED and fires
 * on tick 1. TS used to run the submarine cloak machine before mission
 * dispatch, entered CLOAKING, then surfaced without firing when combat saw the
 * new target.
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

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU11EA submarine cloak order', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('lets AREA_GUARD acquire a target before the first cloak-readiness check', async () => {
    await withDualScenario('SCU11EA', async (handle) => {
      const tick1 = await stepBoth(handle, 1);

      const tsSub = tsUnitAt(tick1.ts.state, 'USSR', 'SS', 67, 101);
      const wasmSub = wasmUnitAt(tick1.wasm.state, 'USSR', 'SS', 67, 101);
      const tsDestroyer = tsUnitAt(tick1.ts.state, 'Greece', 'DD', 67, 97);
      const wasmDestroyer = wasmUnitAt(tick1.wasm.state, 'Greece', 'DD', 67, 97);

      expect(wasmSub.arm).toBeGreaterThan(0);
      expect(tsSub.acd ?? 0).toBe(wasmSub.arm);
      expect(tsSub.tid).toBe(tsDestroyer.id);
      expect(wasmSub.hp).toBe(tsSub.hp);
      expect(wasmDestroyer.hp).toBe(tsDestroyer.hp);
    });
  }, 300_000);
});
