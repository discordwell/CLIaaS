/**
 * Dual-runtime check for TeamClass::Recruit vehicle-class filtering.
 *
 * SCU13EA creates the Greek `hunt1` team on the first logic tick. C++ scans
 * the Units array with an exact vehicle-class prefilter before Can_Add, so the
 * first recruited/initiated member is the 2TNK at (78,59). TS used to scan every
 * vehicle for each missing vehicle slot, recruiting the MGG first and then an
 * extra 2TNK. That made the team reach full strength and consume TeamAI gesture
 * RNG one tick early.
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

function tsUnits(state: AgentState): AgentUnit[] {
  return [...state.units, ...state.enemies];
}

function wasmUnits(state: RAGameState): RAEntity[] {
  return [...state.units, ...state.enemies];
}

function tsGreekUnitAt(state: AgentState, type: string, cx: number, cy: number): AgentUnit {
  const matches = tsUnits(state).filter(u => u.t === type && u.h === 'Greece' && u.cx === cx && u.cy === cy);
  expect(matches).toHaveLength(1);
  return matches[0];
}

function wasmGreekUnitAt(state: RAGameState, type: string, cx: number, cy: number): RAEntity {
  const matches = wasmUnits(state).filter(u => u.t === type && u.house === 'Greece' && u.cx === cx && u.cy === cy);
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU13EA hunt1 vehicle recruit order', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('initiates the same first hunt1 recruit after the create-team tick', async () => {
    await withDualScenario('SCU13EA', async (handle) => {
      const tick1 = await stepBoth(handle, 1);

      const wasmFirstTank = wasmGreekUnitAt(tick1.wasm.state, '2TNK', 78, 59);
      const tsFirstTank = tsGreekUnitAt(tick1.ts.state, '2TNK', 78, 59);
      const wasmMgg = wasmGreekUnitAt(tick1.wasm.state, 'MGG', 78, 60);
      const tsMgg = tsGreekUnitAt(tick1.ts.state, 'MGG', 78, 60);

      expect(!!wasmFirstTank.init).toBe(true);
      expect(!!tsFirstTank.init).toBe(true);
      expect(!!wasmMgg.init).toBe(false);
      expect(!!tsMgg.init).toBe(false);
    });
  }, 300_000);
});
