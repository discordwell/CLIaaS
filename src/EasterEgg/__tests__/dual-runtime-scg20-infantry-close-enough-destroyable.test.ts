/**
 * Dual-runtime check for InfantryClass::Movement_AI blocked start-cell ordering.
 *
 * In SCG20EA a Greek E1 reaches cell (22,57) with NavCom close enough to the
 * adjacent BadGuy infantry at (23,57). C++ validates Path[0], sees the enemy
 * infantry as MOVE_DESTROYABLE, but first applies the Mission_Move
 * CloseEnoughDistance guard and clears NavCom instead of overriding to ATTACK.
 * TS must not turn this into an early TarCom, because that fires one tick ahead
 * of C++ and diverges on the projectile scatter RNG.
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
  type DualStepResult,
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

function wasmUnitAtLepton(state: RAGameState, type: string, house: string, lx: number, ly: number): RAEntity {
  const unit = allWasmUnits(state).find(u =>
    u.t === type &&
    u.house === house &&
    u.lx === lx &&
    u.ly === ly);
  expect(unit, `C++ ${house} ${type} at lepton (${lx},${ly})`).toBeDefined();
  return unit!;
}

function tsUnitAtLepton(state: AgentState, type: string, house: string, lx: number, ly: number): AgentUnit {
  const unit = allTsUnits(state).find(u =>
    u.t === type &&
    u.h === house &&
    u.lx === lx &&
    u.ly === ly);
  expect(unit, `TS ${house} ${type} at lepton (${lx},${ly})`).toBeDefined();
  return unit!;
}

async function stepBothChunked(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<DualStepResult> {
  let result: DualStepResult | null = null;
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 100);
    result = await stepBoth(handle, chunk);
    remaining -= chunk;
  }
  if (!result) throw new Error('No step result produced');
  return result;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG20EA close-enough destroyable infantry blocker', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('clears close-enough NavCom before overriding MOVE_DESTROYABLE infantry blockers', async () => {
    await withDualScenario('SCG20EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothChunked(handle, 204);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);

      const cpp = wasmUnitAtLepton(result.wasm.state, 'E1', 'Greece', 5696, 14784) as
        RAEntity & { tlx?: number; tly?: number };
      const ts = tsUnitAtLepton(result.ts.state, 'E1', 'Greece', 5696, 14784);

      expect(cpp.m).toBe(2); // MISSION_MOVE
      expect(cpp.mq).toBe(-1);
      expect(cpp.nlx).toBeUndefined();
      expect(cpp.nly).toBeUndefined();
      expect(cpp.tlx).toBeUndefined();
      expect(cpp.tly).toBeUndefined();

      expect(ts.m).toBe('MOVE');
      expect(ts.mq).toBeNull();
      expect(ts.mtx).toBeUndefined();
      expect(ts.mty).toBeUndefined();
      expect(ts.tid).toBeUndefined();

      result = await stepBothChunked(handle, 3);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cppTarget = wasmUnitAtLepton(result.wasm.state, 'E1', 'BadGuy', 6080, 14784);
      const tsTarget = tsUnitAtLepton(result.ts.state, 'E1', 'BadGuy', 6080, 14784);
      expect(tsTarget.hp).toBe(cppTarget.hp);
    }, { wasmSeed: 0 });
  }, 300_000);
});
