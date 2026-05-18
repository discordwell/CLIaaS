/**
 * Dual-runtime check for UnitClass::Mission_Harvest -> Mission_Guard Commence.
 *
 * C++ UnitClass::Mission_Harvest queues MISSION_GUARD from GOINGTOIDLE via
 * Assign_Mission(); UnitClass::AI's post-DriveClass Commence then pops that
 * queue in the same object tick and resets Timer to 0. TS must not compensate
 * by direct-setting a Guard delay here: the following tick's Mission_Guard
 * dispatch owns that RNG call.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

const HARVESTER_LOGIC_INDEX = 63;
const FOCUS_E1_LOGIC_INDEX = 88;

type EvalPage = {
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
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

async function wasmLogicEntry(adapter: unknown, logicIndex: number) {
  return adapterPage(adapter).evaluate((idx) => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const entry = (state.logicLayer ?? []).find((row: any[]) => row[0] === idx);
    if (!entry) throw new Error(`C++ logic entry ${idx} missing`);
    return {
      type: entry[1],
      house: entry[2],
      rtti: entry[5],
      mission: entry[7],
      missionTimer: entry[8],
      missionQueue: entry[9],
    };
  }, logicIndex) as Promise<{
    type: string;
    house: string;
    rtti: string;
    mission: number;
    missionTimer: number;
    missionQueue: number;
  }>;
}

async function tsLogicEntity(adapter: unknown, logicIndex: number) {
  return adapterPage(adapter).evaluate((idx) => {
    const game = (window as any).__agentGame;
    const entity = game.entities.find((e: any) => e.logicIndexHint === idx);
    if (!entity) throw new Error(`TS logic entity ${idx} missing`);
    return {
      type: entity.type,
      house: entity.house,
      mission: entity.mission,
      missionTimer: entity.missionTimer,
      missionQueue: entity.missionQueue,
    };
  }, logicIndex) as Promise<{
    type: string;
    house: string;
    mission: string;
    missionTimer: number;
    missionQueue: string | null;
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG08EB harvester guard Commence', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('queues guard from GOINGTOIDLE and leaves the guard timer at zero for the next tick', async () => {
    await withDualScenario('SCG08EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothInCppSizedChunks(handle, 105);
      let cppHarv = await wasmLogicEntry(handle.wasm, HARVESTER_LOGIC_INDEX);
      let tsHarv = await tsLogicEntity(handle.ts, HARVESTER_LOGIC_INDEX);

      expect(cppHarv.type).toBe('HARV');
      expect(cppHarv.mission).toBe(9); // MISSION_HARVEST
      expect(cppHarv.missionTimer).toBe(0);
      expect(tsHarv.type).toBe('HARV');
      expect(tsHarv.mission).toBe('HARVEST');
      expect(tsHarv.missionTimer).toBe(cppHarv.missionTimer);

      result = await stepBothInCppSizedChunks(handle, 1);
      cppHarv = await wasmLogicEntry(handle.wasm, HARVESTER_LOGIC_INDEX);
      tsHarv = await tsLogicEntity(handle.ts, HARVESTER_LOGIC_INDEX);

      expect(cppHarv.mission).toBe(5); // MISSION_GUARD
      expect(cppHarv.missionTimer).toBe(0);
      expect(cppHarv.missionQueue).toBe(-1);
      expect(tsHarv.mission).toBe('GUARD');
      expect(tsHarv.missionTimer).toBe(cppHarv.missionTimer);
      expect(tsHarv.missionQueue).toBeNull();

      result = await stepBothInCppSizedChunks(handle, 1);
      const cppFocusE1 = await wasmLogicEntry(handle.wasm, FOCUS_E1_LOGIC_INDEX);
      const tsFocusE1 = await tsLogicEntity(handle.ts, FOCUS_E1_LOGIC_INDEX);

      expect(tsFocusE1.missionTimer).toBe(cppFocusE1.missionTimer);
      expect(result.ts.state.rngState).toBe(result.wasm.state.rngState);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
