/**
 * Dual-runtime check for FootClass::Mission_Move -> AREA_GUARD archive refresh.
 *
 * In SCG23EA the northeast USSR dog chases an enemy to (101,83), finishes
 * MISSION_MOVE on tick 968, and commences MISSION_GUARD_AREA on tick 969.
 * C++ anchors the new Guard_Area mission at the dog's current coordinate, so
 * the tick-970 Guard_Area timer does not leash it back to its original scenario
 * position near (95,84).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

type EvalPage = {
  evaluate<T>(fn: () => T): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function stepBothChunked(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<DualStepResult> {
  let result: DualStepResult | null = null;
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 25);
    result = await stepBoth(handle, chunk);
    remaining -= chunk;
  }
  if (!result) throw new Error('No step result produced');
  return result;
}

async function wasmDogSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logic = (state.logicLayer ?? []).find((row: any[]) => row[0] === 249);
    if (!logic || logic[1] !== 'DOG' || logic[2] !== 'USSR') {
      throw new Error('C++ SCG23EA dog logic index 249 not found');
    }
    const dog = (state.enemies ?? []).find((unit: any) => unit.id === logic[6]);
    if (!dog) throw new Error('C++ SCG23EA dog unit not found');

    return {
      tick: state.tick,
      rngState: state.rngState,
      dog: {
        mission: logic[7],
        missionTimer: logic[8],
        isDriving: logic[10] === true,
        lx: logic[12],
        ly: logic[13],
        nav: dog.nlx !== undefined && dog.nly !== undefined
          ? { lx: dog.nlx, ly: dog.nly }
          : null,
      },
    };
  });
}

async function tsDogSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const dog = game.entities.find((entity: any) =>
      entity.logicIndexHint === 249 && entity.type === 'DOG' && entity.house === 'USSR');
    if (!dog) throw new Error('TS SCG23EA dog logic index 249 not found');

    return {
      tick: state.tick,
      rngState: state.rngState,
      dog: {
        mission: dog.mission,
        missionTimer: dog.missionTimer,
        isDriving: dog.isDriving === true,
        lx: dog.leptonX,
        ly: dog.leptonY,
        nav: dog.moveTarget
          ? { lx: dog.moveTarget.lx, ly: dog.moveTarget.ly }
          : null,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG23 Area Guard anchor after Move', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('anchors a new AREA_GUARD mission at the current coordinate after MOVE arrival', async () => {
    await withDualScenario('SCG23EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothChunked(handle, 970);
      const [cpp, ts] = await Promise.all([
        wasmDogSnapshot(handle.wasm),
        tsDogSnapshot(handle.ts),
      ]);

      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.dog).toMatchObject({
        mission: 10,
        missionTimer: 72,
        isDriving: false,
        lx: 25920,
        ly: 21440,
        nav: null,
      });
      expect(ts.dog).toMatchObject({
        mission: 'AREA_GUARD',
        missionTimer: cpp.dog.missionTimer,
        isDriving: cpp.dog.isDriving,
        lx: cpp.dog.lx,
        ly: cpp.dog.ly,
        nav: cpp.dog.nav,
      });
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
