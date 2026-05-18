/**
 * Dual-runtime check for InfantryClass::Movement_AI's GUARD NavCom cleanup.
 *
 * In SCG10EB the `ast3` team queues MOVE while the current mission is still
 * GUARD. C++ InfantryClass::Movement_AI does not start pathing under GUARD,
 * but it still applies the pre-path movement-zone abort and clears NavCom when
 * the regroup cell is unreachable. Keeping TS moveTarget alive lets those
 * infantry walk later and creates the tick-91 RNG divergence.
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

const MISSION_GUARD = 5;
const MISSION_MOVE = 2;

function allTsUnits(state: AgentState): AgentUnit[] {
  return [...state.units, ...state.enemies];
}

function allWasmUnits(state: RAGameState): RAEntity[] {
  return [...state.units, ...state.enemies];
}

function wasmSovietE1At(state: RAGameState, lx: number, ly: number): RAEntity {
  const unit = allWasmUnits(state).find(u =>
    u.t === 'E1' &&
    u.house === 'USSR' &&
    u.lx === lx &&
    u.ly === ly);
  expect(unit, `C++ USSR E1 at lepton (${lx},${ly})`).toBeDefined();
  return unit!;
}

function tsSovietE1At(state: AgentState, lx: number, ly: number): AgentUnit {
  const unit = allTsUnits(state).find(u =>
    u.t === 'E1' &&
    u.h === 'USSR' &&
    u.lx === lx &&
    u.ly === ly);
  expect(unit, `TS USSR E1 at lepton (${lx},${ly})`).toBeDefined();
  return unit!;
}

async function stepBothInCppSizedChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  let remaining = ticks;
  while (remaining > 0) {
    const step = Math.min(remaining, 15);
    result = await stepBoth(handle, step);
    remaining -= step;
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG10EB GUARD zone abort clears NavCom', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('clears out-of-zone GUARD destinations while preserving the queued MOVE', async () => {
    await withDualScenario('SCG10EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothInCppSizedChunks(handle, 67);

      for (const [lx, ly] of [[14016, 19264], [15744, 20096]] as const) {
        const cpp = wasmSovietE1At(result.wasm.state, lx, ly);
        expect(cpp.m).toBe(MISSION_GUARD);
        expect(cpp.mq).toBe(MISSION_MOVE);
        expect(cpp.nlx).toBeUndefined();
        expect(cpp.nly).toBeUndefined();

        const ts = tsSovietE1At(result.ts.state, lx, ly);
        expect(ts.m).toBe('GUARD');
        expect(ts.mq).toBe('MOVE');
        expect(ts.mtx).toBeUndefined();
        expect(ts.mty).toBeUndefined();
      }

      result = await stepBothInCppSizedChunks(handle, 11);
      for (const [lx, ly] of [[14016, 19264], [15744, 20096]] as const) {
        const cpp = wasmSovietE1At(result.wasm.state, lx, ly);
        expect(cpp.m).toBe(MISSION_MOVE);
        expect(cpp.mq).toBe(-1);
        expect(cpp.drv).toBe(false);
        expect(cpp.nlx).toBeUndefined();
        expect(cpp.nly).toBeUndefined();

        const ts = tsSovietE1At(result.ts.state, lx, ly);
        expect(ts.m).toBe('MOVE');
        expect(ts.mq).toBeNull();
        expect(ts.drv).toBe(false);
        expect(ts.mtx).toBeUndefined();
        expect(ts.mty).toBeUndefined();
      }

      result = await stepBothInCppSizedChunks(handle, 14);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
