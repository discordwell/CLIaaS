/**
 * Dual-runtime check for LST retreat movement while the door is open.
 *
 * SCU14EA's Greek LST unloads cargo at the eastern shore, then auto-retreats
 * south. C++ gates VesselClass's post-DriveClass Commence call while the LST
 * door is open, but DriveClass::AI itself keeps consuming track movement. TS
 * must not treat an open door as a movement-cycle stop, or the LST lingers
 * until the next retreat timer refresh instead of leaving the map at tick 890.
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

const WASM_MISSION_RETREAT = 4;

function findWasmEasternGreekLST(state: RAGameState): RAEntity | undefined {
  return [...state.units, ...state.enemies]
    .find(u => u.t === 'LST' && u.house === 'Greece' && u.cx >= 90);
}

function findTsEasternGreekLST(state: AgentState): AgentUnit | undefined {
  return [...state.units, ...state.enemies]
    .find(u => u.t === 'LST' && u.h === 'Greece' && u.cx >= 90);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU14 LST retreat with open door', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the retreating Greek LST driving and deletes it at the C++ edge tick', async () => {
    await withDualScenario('SCU14EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBoth(handle, 790);
      const cppDriving = findWasmEasternGreekLST(result.wasm.state);
      const tsDriving = findTsEasternGreekLST(result.ts.state);

      expect(cppDriving, 'C++ eastern Greek LST at tick 790').toMatchObject({
        t: 'LST',
        house: 'Greece',
        cx: 98,
        cy: 101,
        m: WASM_MISSION_RETREAT,
        mt: 62,
        drv: true,
      });
      expect(tsDriving, 'TS eastern Greek LST at tick 790').toMatchObject({
        t: 'LST',
        h: 'Greece',
        cx: cppDriving!.cx,
        cy: cppDriving!.cy,
        m: 'RETREAT',
        mt: cppDriving!.mt,
        drv: cppDriving!.drv,
      });
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      result = await stepBoth(handle, 100);
      expect(findWasmEasternGreekLST(result.wasm.state), 'C++ deletes eastern Greek LST at tick 890')
        .toBeUndefined();
      expect(findTsEasternGreekLST(result.ts.state), 'TS deletes eastern Greek LST at tick 890')
        .toBeUndefined();
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
