/**
 * Dual-runtime check for TechnoClass::Assign_Target singleton TarCom behavior.
 *
 * In SCU09EA, a Greece 2TNK initially guards against a Soviet PROC, then takes
 * V2RL damage and retaliates. C++ stores only one TarCom, so the retaliation
 * replaces the building target with the V2RL object target; when the tank's Arm
 * reaches zero it fires at the V2RL and reloads. TS used to keep both the old
 * targetStructure and the new target entity, route firing through the stale
 * structure target, and leave attackCooldown at zero.
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

function tsScu09RetaliatingTank(state: AgentState): AgentUnit {
  const matches = tsUnits(state).filter(u =>
    u.t === '2TNK' && u.h === 'Greece' && u.cx === 96 && u.cy === 92);
  expect(matches).toHaveLength(1);
  return matches[0];
}

function wasmScu09RetaliatingTank(state: RAGameState): WasmEntityWithArm {
  const matches = wasmUnits(state).filter(u =>
    u.t === '2TNK' && u.house === 'Greece' && u.cx === 96 && u.cy === 92);
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: retaliation replaces TarCom target kind', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps SCU09EA 2TNK reload state synced after retaliating from PROC to V2RL', async () => {
    await withDualScenario('SCU09EA', async (handle) => {
      const tick57 = await stepBoth(handle, 57);

      const tsTank = tsScu09RetaliatingTank(tick57.ts.state);
      const wasmTank = wasmScu09RetaliatingTank(tick57.wasm.state);

      expect(wasmTank.arm).toBeGreaterThan(0);
      expect(tsTank.acd ?? 0).toBe(wasmTank.arm);
    });
  }, 300_000);
});
