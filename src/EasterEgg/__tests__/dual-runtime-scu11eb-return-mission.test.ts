/**
 * Dual-runtime check for scenario INI mission-name parsing.
 *
 * SCU11EB places a Greece ARTY with mission "Return". C++ parses that through
 * MissionClass::Mission_From_Name to MISSION_RETURN; TS must not silently fall
 * through to GUARD and consume first-tick guard RNG.
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

function wasmReturnArty(state: RAGameState): RAEntity {
  const unit = allWasmUnits(state).find(u => u.t === 'ARTY' && u.house === 'Greece' && u.cx === 32 && u.cy === 59);
  if (!unit) throw new Error('C++ SCU11EB Greece Return ARTY at cell 7584 not found');
  return unit;
}

function tsReturnArty(state: AgentState): AgentUnit {
  const unit = allTsUnits(state).find(u => u.t === 'ARTY' && u.h === 'Greece' && u.cx === 32 && u.cy === 59);
  if (!unit) throw new Error('TS SCU11EB Greece Return ARTY at cell 7584 not found');
  return unit;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU11EB Return mission parsing', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('parses scenario mission "Return" as MISSION_RETURN and preserves first-tick RNG parity', async () => {
    await withDualScenario('SCU11EB', async (handle) => {
      let cpp = wasmReturnArty(handle.wasmState);
      let ts = tsReturnArty(handle.tsState);
      expect(cpp.m).toBe(11);
      expect(ts.m).toBe('RETURN');

      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      const result = await stepBoth(handle, 1);
      expect(result.ts.state.tick).toBe(result.wasm.state.tick);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      cpp = wasmReturnArty(result.wasm.state);
      ts = tsReturnArty(result.ts.state);
      expect(ts.m).toBe('RETURN');
      expect(ts.mt).toBe(cpp.mt);
    }, { wasmSeed: 0 });
  }, 240_000);
});
