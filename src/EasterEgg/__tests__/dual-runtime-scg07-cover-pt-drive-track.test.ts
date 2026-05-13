/**
 * Dual-runtime check for DriveClass::AI active-track movement after Path[0]
 * is cleared.
 *
 * SCG07EA's `cover` reinforcement team sends three patrol boats through two
 * MOVE waypoints. When TeamClass advances to the second waypoint, C++
 * DriveClass::Assign_Destination clears Path[0] but preserves the active
 * Head_To_Coord track. While_Moving continues that track even though Path[] is
 * empty. TS used to return early on empty path, freezing the cover PTs near the
 * first waypoint until their later guard RNG diverged.
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

type PtPos = { cx: number; cy: number; lx: number; ly: number };

function sortPts(rows: PtPos[]): PtPos[] {
  return [...rows].sort((a, b) => (a.cx - b.cx) || (a.cy - b.cy) || (a.lx - b.lx) || (a.ly - b.ly));
}

function tsCoverPts(state: AgentState): PtPos[] {
  return sortPts(state.units
    .filter((u: AgentUnit) => u.h === 'Greece' && u.t === 'PT' && u.cy >= 53 && u.cy <= 54)
    .map((u: AgentUnit) => ({ cx: u.cx, cy: u.cy, lx: u.lx!, ly: u.ly! })));
}

function wasmCoverPts(state: RAGameState): PtPos[] {
  return sortPts(state.units
    .filter((u: RAEntity) => u.house === 'Greece' && u.t === 'PT' && u.cy >= 53 && u.cy <= 54)
    .map((u: RAEntity) => ({ cx: u.cx, cy: u.cy, lx: u.lx!, ly: u.ly! })));
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG07EA cover PT active track', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('continues vessel While_Moving after TeamClass clears Path[0]', async () => {
    await withDualScenario('SCG07EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState);

      const result = await stepBoth(handle, 280);

      const wasmPts = wasmCoverPts(result.wasm.state);
      const tsPts = tsCoverPts(result.ts.state);

      expect(wasmPts).toHaveLength(3);
      expect(tsPts).toEqual(wasmPts);
    });
  }, 300_000);
});
