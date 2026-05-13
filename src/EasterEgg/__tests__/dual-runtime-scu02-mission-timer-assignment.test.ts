/**
 * Dual-runtime check for C++ CDTimerClass assignment semantics.
 *
 * MissionClass stores returned handler delays in a CDTimerClass<FrameTimerClass>.
 * Assigning Timer = delay starts at the current frame, so the visible Value()
 * remains the full delay until the following frame. TS must not decrement a
 * freshly assigned missionTimer in the same object AI pass.
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

function wasmGoodGuyRifle(state: RAGameState): RAEntity {
  const unit = allWasmUnits(state).find(u => u.id === 851979);
  if (!unit) throw new Error('C++ SCU02EA GoodGuy E1 id 851979 not found');
  return unit;
}

function tsGoodGuyRifle(state: AgentState): AgentUnit {
  const unit = allTsUnits(state).find(u => u.id === 52);
  if (!unit) throw new Error('TS SCU02EA GoodGuy E1 id 52 not found');
  return unit;
}

async function stepBothOneTickAtATime(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  for (let i = 0; i < ticks; i++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: mission timer assignment', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not decrement a freshly assigned MissionClass timer until the next frame', async () => {
    await withDualScenario('SCU02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBoth(handle, 1);
      let wasm = wasmGoodGuyRifle(result.wasm.state);
      let ts = tsGoodGuyRifle(result.ts.state);
      expect(ts.mt, 'Mission_Guard returned timer at tick 1').toBe(wasm.mt);

      result = await stepBothOneTickAtATime(handle, 10);
      wasm = wasmGoodGuyRifle(result.wasm.state);
      ts = tsGoodGuyRifle(result.ts.state);
      expect(ts.mt, 'Mission_Move returned timer at tick 11').toBe(wasm.mt);
    }, { wasmSeed: 0 });
  }, 300_000);
});
