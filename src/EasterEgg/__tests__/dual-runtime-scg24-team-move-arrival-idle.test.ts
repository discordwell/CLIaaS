/**
 * Dual-runtime check for DriveClass Basic_Path arrival idling.
 *
 * In SCG24EA, the Greek team jeep at logic index 184 reaches its active track
 * target on tick 190 while still close to the team's NavCom. C++ DriveClass
 * sees the destination's physical Cell_Occupier chain as MOVE_TEMP, fails to
 * regenerate a Basic_Path, clears NavCom through Assign_Destination(TARGET_NONE),
 * and immediately queues idle because the vehicle is no longer driving. TS must
 * not route into a transient infantry sub-cell claim ahead of that physical
 * occupant result.
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

async function wasmCoverJeepSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const unit = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((entry: any) => entry.id === 1835025);
    const logic = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === 184);
    if (!unit || !logic) throw new Error('SCG24 cover jeep was not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: logic[7],
      missionTimer: logic[8],
      missionQueue: logic[9],
      isDriving: logic[10],
      lx: logic[12],
      ly: logic[13],
      nav: unit.nlx !== undefined && unit.nly !== undefined
        ? { lx: unit.nlx, ly: unit.nly }
        : null,
      headTo: unit.hlx !== undefined && unit.hly !== undefined
        ? { lx: unit.hlx, ly: unit.hly }
        : null,
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    mission: number;
    missionTimer: number;
    missionQueue: number;
    isDriving: boolean;
    lx: number;
    ly: number;
    nav: { lx: number; ly: number } | null;
    headTo: { lx: number; ly: number } | null;
  }>;
}

async function tsCoverJeepSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const unit = ((game?.entities ?? []) as any[])
      .find(entity => entity.logicIndexHint === 184 && entity.type === 'JEEP');
    if (!unit) throw new Error('SCG24 TS cover jeep was not found');
    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: unit.mission,
      missionTimer: unit.missionTimer,
      missionQueue: unit.missionQueue,
      isDriving: unit.isDriving,
      lx: unit.leptonX,
      ly: unit.leptonY,
      nav: unit.moveTarget
        ? { lx: unit.moveTarget.lx, ly: unit.moveTarget.ly }
        : null,
      headTo: unit.headToLX || unit.headToLY
        ? { lx: unit.headToLX, ly: unit.headToLY }
        : null,
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    mission: string;
    missionTimer: number;
    missionQueue: string | null;
    isDriving: boolean;
    lx: number;
    ly: number;
    nav: { lx: number; ly: number } | null;
    headTo: { lx: number; ly: number } | null;
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG24 team move arrival idle', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('queues and commences GUARD when the cover jeep reaches its team move target', async () => {
    await withDualScenario('SCG24EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInCppSizedChunks(handle, 189);
      const cppBefore = await wasmCoverJeepSnapshot(handle.wasm);
      const tsBefore = await tsCoverJeepSnapshot(handle.ts);

      expect(cppBefore.tick).toBe(189);
      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(cppBefore.mission).toBe(2);
      expect(tsBefore.mission).toBe('MOVE');
      expect(cppBefore.isDriving).toBe(true);
      expect(tsBefore.isDriving).toBe(true);

      await stepBoth(handle, 1);
      const cppArrival = await wasmCoverJeepSnapshot(handle.wasm);
      const tsArrival = await tsCoverJeepSnapshot(handle.ts);

      expect(cppArrival.tick).toBe(190);
      expect(tsArrival.tick).toBe(cppArrival.tick);
      expect(cppArrival.lx).toBe(11904);
      expect(cppArrival.ly).toBe(6272);
      expect(cppArrival.mission).toBe(5);
      expect(cppArrival.missionTimer).toBe(0);
      expect(cppArrival.nav).toBeNull();

      expect(tsArrival.lx).toBe(cppArrival.lx);
      expect(tsArrival.ly).toBe(cppArrival.ly);
      expect(tsArrival.mission).toBe('GUARD');
      expect(tsArrival.missionTimer).toBe(cppArrival.missionTimer);
      expect(tsArrival.nav).toBeNull();

      await stepBoth(handle, 1);
      const cppGuard = await wasmCoverJeepSnapshot(handle.wasm);
      const tsGuard = await tsCoverJeepSnapshot(handle.ts);

      expect(cppGuard.tick).toBe(191);
      expect(tsGuard.tick).toBe(cppGuard.tick);
      expect(tsGuard.rngState >>> 0).toBe(cppGuard.rngState >>> 0);
      expect(tsGuard.mission).toBe('GUARD');
      expect(tsGuard.missionTimer).toBe(cppGuard.missionTimer);
    }, { wasmSeed: 0 });
  }, 300_000);
});
