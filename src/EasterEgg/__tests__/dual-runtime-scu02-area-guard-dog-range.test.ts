/**
 * Dual-runtime check for FootClass::Mission_Guard_Area using Threat_Range(1).
 *
 * SCU02EA has a USSR dog at C++ logic[47] / TS logic[47]. On tick 145 C++
 * scans from ArchiveTarget with the DOG type GuardRange override: Threat_Range(1)
 * doubles GuardRange=7 and caps it to 10 cells, so the dog acquires the Greece
 * E1 near (74,64) and returns delay 1 with no Random_Pick(1,5). Computing area
 * range from DogJaw weapon range misses that target and spends jitter RNG.
 *
 * This runs with source fog preserved because C++ keeps IsDiscoveredByPlayer
 * persistent across ordinary fog downgrades. Clearing the discovered flag before
 * Logic.AI makes the dog skip the C++ target and acquire an inner-ring E1.
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

type EvalPage = {
  evaluate<T>(fn: () => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmDogSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = state.logicLayer.find((r: any[]) =>
      r[1] === 'DOG' && r[2] === 'USSR' && r[3] === 77 && r[4] === 59);
    if (!row) throw new Error('C++ SCU02EA dog target missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      dog: {
        mission: row[7],
        missionTimer: row[8],
        targetX: row[21],
        targetY: row[22],
      },
    };
  });
}

async function tsDogSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const dog = game.entities.find((e: any) =>
      e.type === 'DOG' && e.house === 'USSR' && e.cell?.cx === 77 && e.cell?.cy === 59);
    if (!dog) throw new Error('TS SCU02EA dog target missing');
    return {
      tick: game.tick,
      rngState: (window as any).__agentState().rngState,
      dog: {
        mission: dog.mission,
        missionTimer: dog.missionTimer,
        targetX: dog.target?.leptonX ?? 0,
        targetY: dog.target?.leptonY ?? 0,
      },
    };
  });
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

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU02EA area guard dog range', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('uses DOG GuardRange for Mission_Guard_Area Threat_Range(1)', async () => {
    await withDualScenario('SCU02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let result = await stepBothOneTickAtATime(handle, 144);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cppBefore = await wasmDogSnapshot(handle.wasm);
      const tsBefore = await tsDogSnapshot(handle.ts);
      expect(cppBefore.dog.missionTimer).toBe(0);
      expect(tsBefore.dog.missionTimer).toBe(0);
      expect(cppBefore.dog.targetX).toBe(0);
      expect(tsBefore.dog.targetX).toBe(0);

      result = await stepBoth(handle, 1);

      const cppAfter = await wasmDogSnapshot(handle.wasm);
      const tsAfter = await tsDogSnapshot(handle.ts);
      expect(cppAfter.dog.missionTimer).toBe(0);
      expect(tsAfter.dog.missionTimer).toBe(cppAfter.dog.missionTimer);
      expect(cppAfter.dog.targetX).toBeGreaterThan(0);
      expect(tsAfter.dog.targetX).toBe(cppAfter.dog.targetX);
      expect(tsAfter.dog.targetY).toBe(cppAfter.dog.targetY);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
