/**
 * Dual-runtime check for SCA02EA's early los2 trigger.
 *
 * C++ HouseClass::Recalc_Attributes builds Active*Scan from locked, non-limbo
 * objects, and in normal campaign excludes human-house objects that have not
 * been discovered by PlayerPtr. SCA02EA starts with only hidden Spain barrels,
 * so los2 fires on the first normal trigger pass.
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

function antAtTs(state: AgentState, cx: number, cy: number): AgentUnit {
  const unit = allTsUnits(state).find(u => u.t === 'ANT1' && u.cx === cx && u.cy === cy);
  if (!unit) throw new Error(`TS ANT1 at ${cx},${cy} not found`);
  return unit;
}

function antAtWasm(state: RAGameState, cx: number, cy: number): RAEntity {
  const unit = allWasmUnits(state).find(u => u.t === 'ANT1' && u.cx === cx && u.cy === cy);
  if (!unit) throw new Error(`C++ ANT1 at ${cx},${cy} not found`);
  return unit;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCA02EA los2 active scan', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('fires los2 from the first Active*Scan pass and stops before ant guard RNG diverges', async () => {
    await withDualScenario('SCA02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBoth(handle, 1);
      expect(result.wasm.state.losePending).toBe(true);
      expect(result.ts.state.losePending).toBe(true);
      expect(result.ts.state.triggers.find(t => t.name === 'los2')?.fired).toBe(true);

      for (let i = 0; i < 30; i++) {
        const prevWasmTick = result.wasm.state.tick;
        result = await stepBoth(handle, 1);
        if (result.wasm.state.tick === prevWasmTick) break;
      }

      expect(result.wasm.state.tick).toBe(25);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);
      expect(result.ts.state.state).toBe('lost');
      expect(antAtTs(result.ts.state, 98, 18).mt).toBe(antAtWasm(result.wasm.state, 98, 18).mt);
      expect(antAtTs(result.ts.state, 98, 18).mt).toBe(5);
    }, { wasmSeed: 0 });
  }, 300_000);
});
