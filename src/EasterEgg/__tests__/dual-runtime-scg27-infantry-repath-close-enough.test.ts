/**
 * Dual-runtime check for InfantryClass::Movement_AI repath ordering.
 *
 * SCG27EA has a BadGuy E2 whose cached Path[0] becomes blocked while it is
 * already close to NavCom. C++ invalidates the cached path, runs Basic_Path(),
 * and starts a new hop if that succeeds; it only clears NavCom on close-enough
 * after Basic_Path fails or after the freshly selected acell is still blocked.
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

async function wasmBadGuyE2Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === 115);
    if (!row) throw new Error('C++ SCG27EA BadGuy E2 logic 115 missing');

    const unit = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((entry: any) => entry.id === row[6]);
    if (!unit) throw new Error('C++ SCG27EA BadGuy E2 detail missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      mission: row[7],
      missionTimer: row[8],
      isDriving: row[10],
      lx: row[12],
      ly: row[13],
      nav: unit.nlx !== undefined && unit.nly !== undefined
        ? { lx: unit.nlx, ly: unit.nly }
        : null,
      headTo: unit.hlx !== undefined && unit.hly !== undefined
        ? { lx: unit.hlx, ly: unit.hly }
        : null,
      path: [unit.p0, unit.p1, unit.p2],
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    mission: number;
    missionTimer: number;
    isDriving: boolean;
    lx: number;
    ly: number;
    nav: { lx: number; ly: number } | null;
    headTo: { lx: number; ly: number } | null;
    path: [number, number, number];
  }>;
}

async function tsBadGuyE2Snapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const entity = game.entities.find((e: any) => e.logicIndexHint === 115);
    if (!entity) throw new Error('TS SCG27EA BadGuy E2 logic 115 missing');

    return {
      tick: game.tick,
      rngState: (window as any).__agentState().rngState,
      mission: entity.mission,
      missionTimer: entity.missionTimer,
      isDriving: entity.isDriving,
      lx: entity.leptonX,
      ly: entity.leptonY,
      nav: entity.moveTarget
        ? { lx: entity.moveTarget.lx, ly: entity.moveTarget.ly }
        : null,
      headTo: entity.headToLX || entity.headToLY
        ? { lx: entity.headToLX, ly: entity.headToLY }
        : null,
      facings: entity.drivePathFacings.slice(0, 3),
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    mission: string;
    missionTimer: number;
    isDriving: boolean;
    lx: number;
    ly: number;
    nav: { lx: number; ly: number } | null;
    headTo: { lx: number; ly: number } | null;
    facings: number[];
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG27 infantry close-enough repath', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('repaths a blocked cached MOVE path before applying close-enough NavCom clear', async () => {
    await withDualScenario('SCG27EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInCppSizedChunks(handle, 306);
      const cppBefore = await wasmBadGuyE2Snapshot(handle.wasm);
      const tsBefore = await tsBadGuyE2Snapshot(handle.ts);

      expect(cppBefore.tick).toBe(306);
      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(cppBefore.isDriving).toBe(false);
      expect(tsBefore.isDriving).toBe(false);
      expect(tsBefore.nav).toEqual(cppBefore.nav);
      expect(cppBefore.path[0]).toBe(7);
      expect(tsBefore.facings[0]).toBe(cppBefore.path[0]);

      await stepBoth(handle, 1);
      const cppAfter = await wasmBadGuyE2Snapshot(handle.wasm);
      const tsAfter = await tsBadGuyE2Snapshot(handle.ts);

      expect(cppAfter.tick).toBe(307);
      expect(tsAfter.tick).toBe(cppAfter.tick);
      expect(tsAfter.rngState >>> 0).toBe(cppAfter.rngState >>> 0);
      expect(cppAfter.isDriving).toBe(true);
      expect(tsAfter.isDriving).toBe(true);
      expect(tsAfter.nav).toEqual(cppAfter.nav);
      expect(tsAfter.headTo).toEqual(cppAfter.headTo);
      expect(tsAfter.mission).toBe('MOVE');
      expect(cppAfter.mission).toBe(2);
    }, { wasmSeed: 0 });
  }, 300_000);
});
