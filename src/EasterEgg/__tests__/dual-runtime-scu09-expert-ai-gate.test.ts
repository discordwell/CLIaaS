/**
 * Dual-runtime behavioral check for HouseClass::AI's Expert_AI gate.
 *
 * SCU09EA creates the Germany `eMCV` team on tick 1. C++ recruits the MCV but
 * does not run Expert_AI for Germany because IsBaseBuilding is false and IQ=3,
 * so the MCV remains on MISSION_GUARD. If TS runs the strategic planner for
 * this house anyway, it fire-sales/all-hunts Germany and the MCV switches to
 * HUNT, causing the tick-2 RNG divergence.
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

const WASM_MISSION_GUARD = 5;

function tsUnits(state: AgentState): AgentUnit[] {
  return [...state.units, ...state.enemies];
}

function wasmUnits(state: RAGameState): RAEntity[] {
  return [...state.units, ...state.enemies];
}

function tsGermanyMcv(state: AgentState): AgentUnit {
  const matches = tsUnits(state).filter(u =>
    u.t === 'MCV' && u.h === 'Germany' && u.cx === 66 && u.cy === 33);
  expect(matches).toHaveLength(1);
  return matches[0];
}

function wasmGermanyMcv(state: RAGameState): RAEntity {
  const matches = wasmUnits(state).filter(u =>
    u.t === 'MCV' && u.house === 'Germany' && u.cx === 66 && u.cy === 33);
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: Expert_AI IsBaseBuilding gate', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the SCU09EA Germany MCV on GUARD after eMCV recruitment', async () => {
    await withDualScenario('SCU09EA', async (handle) => {
      expect(tsGermanyMcv(handle.tsState).m).toBe('GUARD');
      expect(wasmGermanyMcv(handle.wasmState).m).toBe(WASM_MISSION_GUARD);

      const tick1 = await stepBoth(handle, 1);

      expect(tsGermanyMcv(tick1.ts.state).m).toBe('GUARD');
      expect(wasmGermanyMcv(tick1.wasm.state).m).toBe(WASM_MISSION_GUARD);
    });
  }, 300_000);
});
