/**
 * Dual-runtime check for C++ dog-rides-bullet unlimbo semantics.
 *
 * SCU02EA tick 940 exercises BulletClass::~BulletClass putting a dog back into
 * Logic after DogJaw impact. C++ runs TechnoClass::Unlimbo, which calls
 * InfantryClass::Enter_Idle_Mode(true) and Commence(); it does not synthesize a
 * MOVE order from the dog's guard origin.
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

async function wasmDogSnapshot(adapter: unknown, dogId: number) {
  return adapterPage(adapter).evaluate((targetDogId) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const dog = state.logicLayer.find((r: any[]) => r[6] === targetDogId);
    if (!dog) throw new Error(`C++ SCU02EA dog id ${targetDogId} missing from Logic`);
    return {
      tick: state.tick,
      rngState: state.rngState,
      dog: {
        logicIndex: dog[0],
        mission: dog[7],
        missionTimer: dog[8],
        missionQueue: dog[9],
        isDriving: dog[10],
        doing: dog[11],
        leptonX: dog[12],
        leptonY: dog[13],
        hp: dog[14],
        attackCooldown: dog[23],
        targetLeptonX: dog[21],
        targetLeptonY: dog[22],
      },
    };
  }, dogId);
}

async function tsDogSnapshot(adapter: unknown, dogId: number) {
  return adapterPage(adapter).evaluate((targetDogId) => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const dog = game.entities.find((e: any) => e.id === targetDogId);
    if (!dog) throw new Error(`TS SCU02EA dog id ${targetDogId} missing`);
    return {
      tick: game.tick,
      rngState: state.rngState,
      dog: {
        logicIndexHint: dog.logicIndexHint,
        mission: dog.mission,
        missionTimer: dog.missionTimer,
        missionQueue: dog.missionQueue,
        isDriving: dog.isDriving,
        doing: dog.doing,
        inLimbo: dog.inLimbo,
        leptonX: dog.leptonX,
        leptonY: dog.leptonY,
        hp: dog.hp,
        attackCooldown: dog.attackCooldown,
        targetId: dog.target?.id ?? null,
        targetStructure: dog.targetStructure?.type ?? null,
        moveTarget: dog.moveTarget ? { lx: dog.moveTarget.lx, ly: dog.moveTarget.ly } : null,
        headTo: dog.headToLX || dog.headToLY ? { lx: dog.headToLX, ly: dog.headToLY } : null,
      },
    };
  }, dogId);
}

async function stepBothInCppSizedChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 15);
    result = await stepBoth(handle, chunk);
    remaining -= chunk;
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU02EA dog maul unlimbo', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('preserves active driver state after a DogJaw rider returns from limbo', async () => {
    await withDualScenario('SCU02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBothInCppSizedChunks(handle, 228);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cpp = await wasmDogSnapshot(handle.wasm, 851982);
      const ts = await tsDogSnapshot(handle.ts, 55);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.dog.mission).toBe(2);
      expect(ts.dog.mission).toBe('MOVE');
      expect(ts.dog.missionTimer).toBe(cpp.dog.missionTimer);
      expect(cpp.dog.missionTimer).toBe(6);
      expect(ts.dog.missionQueue).toBeNull();
      expect(cpp.dog.missionQueue).toBe(-1);
      expect(ts.dog.isDriving).toBe(true);
      expect(cpp.dog.isDriving).toBe(true);
      expect(ts.dog.moveTarget).not.toBeNull();
      expect(ts.dog.headTo).not.toBeNull();
      expect(ts.dog.leptonX).toBe(cpp.dog.leptonX);
      expect(ts.dog.leptonY).toBe(cpp.dog.leptonY);
      expect(ts.dog.targetId).toBeNull();
      expect(ts.dog.targetStructure).toBeNull();
    }, { wasmSeed: 0 });
  }, 180_000);

  it('does not fire a second DogJaw while the dog maul action is still running', async () => {
    await withDualScenario('SCU02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBothInCppSizedChunks(handle, 1164);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cpp = await wasmDogSnapshot(handle.wasm, 851978);
      const ts = await tsDogSnapshot(handle.ts, 51);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.dog.mission).toBe(10);
      expect(ts.dog.mission).toBe('AREA_GUARD');
      expect(ts.dog.missionTimer).toBe(cpp.dog.missionTimer);
      expect(cpp.dog.missionTimer).toBe(71);
      expect(ts.dog.isDriving).toBe(false);
      expect(cpp.dog.isDriving).toBe(false);
      expect(ts.dog.inLimbo).toBe(false);
      expect(cpp.dog.doing).toBe(20);
      expect(ts.dog.doing).toBe('dog_maul');
      expect(ts.dog.attackCooldown).toBe(cpp.dog.attackCooldown);
      expect(cpp.dog.attackCooldown).toBe(0);
      expect(ts.dog.leptonX).toBe(cpp.dog.leptonX);
      expect(ts.dog.leptonY).toBe(cpp.dog.leptonY);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('processes a dog reinserted by DogJaw impact later in the same Logic tick', async () => {
    await withDualScenario('SCU02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBothInCppSizedChunks(handle, 1183);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cpp = await wasmDogSnapshot(handle.wasm, 851978);
      const ts = await tsDogSnapshot(handle.ts, 51);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.dog.mission).toBe(2);
      expect(ts.dog.mission).toBe('MOVE');
      expect(ts.dog.missionTimer).toBe(cpp.dog.missionTimer);
      expect(cpp.dog.missionTimer).toBe(14);
      expect(ts.dog.missionQueue).toBeNull();
      expect(cpp.dog.missionQueue).toBe(-1);
      expect(ts.dog.isDriving).toBe(true);
      expect(cpp.dog.isDriving).toBe(true);
      expect(ts.dog.inLimbo).toBe(false);
      expect(cpp.dog.doing).toBe(20);
      expect(ts.dog.doing).toBe('dog_maul');
      expect(ts.dog.leptonX).toBe(cpp.dog.leptonX);
      expect(ts.dog.leptonY).toBe(cpp.dog.leptonY);
    }, { wasmSeed: 0 });
  }, 180_000);

  it('returns the DogJaw rider to GUARD without creating a stale MOVE order', async () => {
    await withDualScenario('SCU02EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBothInCppSizedChunks(handle, 940);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);

      const cpp = await wasmDogSnapshot(handle.wasm, 851981);
      const ts = await tsDogSnapshot(handle.ts, 55);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.dog.mission).toBe(5);
      expect(ts.dog.mission).toBe('GUARD');
      expect(ts.dog.missionTimer).toBe(cpp.dog.missionTimer);
      expect(cpp.dog.missionTimer).toBe(34);
      expect(ts.dog.missionQueue).toBeNull();
      expect(cpp.dog.missionQueue).toBe(-1);
      expect(ts.dog.isDriving).toBe(false);
      expect(cpp.dog.isDriving).toBe(false);
      expect(ts.dog.moveTarget).toBeNull();
      expect(cpp.dog.doing).toBe(20);
      expect(ts.dog.doing).toBe('dog_maul');
      expect(ts.dog.inLimbo).toBe(false);
      expect(ts.dog.leptonX).toBe(cpp.dog.leptonX);
      expect(ts.dog.leptonY).toBe(cpp.dog.leptonY);
      expect(ts.dog.attackCooldown).toBe(cpp.dog.attackCooldown);
      expect(cpp.dog.attackCooldown).toBe(2);
      expect(ts.dog.targetId).toBeNull();
      expect(ts.dog.targetStructure).toBeNull();
      expect(cpp.dog.targetLeptonX).toBe(0);
      expect(cpp.dog.targetLeptonY).toBe(0);
    }, { wasmSeed: 0 });
  }, 180_000);
});
