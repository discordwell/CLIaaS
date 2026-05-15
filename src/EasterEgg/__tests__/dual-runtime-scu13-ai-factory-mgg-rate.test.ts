/**
 * Dual-runtime check for C++ FactoryClass::Start rate granularity.
 *
 * SCU13EA's GoodGuy WEAP starts an MGG on tick 2. C++ computes the factory
 * rate from TechnoTypeClass::Time_To_Build using fixed-point arithmetic and a
 * 54-step StageClass timer. The MGG is complete by tick 488 and exits on tick
 * 489, immediately consuming Mission_Guard RNG. If TS is even one factory step
 * behind, the first RNG divergence appears at tick 489.
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

async function wasmGoodGuyWeapFactory(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const weap = (state.structures ?? []).find((s: any) =>
      s.t === 'WEAP' &&
      s.house === 'GoodGuy' &&
      s.cx === 26 &&
      s.cy === 50);
    if (!weap) throw new Error('C++ SCU13EA GoodGuy WEAP missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      factory: weap.factory
        ? {
            type: weap.factory.t,
            progress: weap.factory.prog,
            done: weap.factory.done,
            building: weap.factory.building,
          }
        : null,
    };
  });
}

async function tsGoodGuyWeapFactory(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const weap = game.structures.find((s: any) =>
      s.type === 'WEAP' &&
      s.house === 'GoodGuy' &&
      s.cx === 25 &&
      s.cy === 50);
    if (!weap) throw new Error('TS SCU13EA GoodGuy WEAP missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      factory: weap.aiFactory
        ? {
            type: weap.aiFactory.productType,
            progress: weap.aiFactory.stage,
            done: weap.aiFactory.stage >= 54,
            suspended: weap.aiFactory.suspended,
          }
        : null,
    };
  });
}

async function wasmProducedMgg(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const mgg = [...(state.units ?? []), ...(state.enemies ?? [])].find((u: any) =>
      u.t === 'MGG' &&
      u.house === 'GoodGuy' &&
      u.cx === 26 &&
      u.cy === 51);
    if (!mgg) throw new Error('C++ SCU13EA produced GoodGuy MGG missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      unit: {
        type: mgg.t,
        house: mgg.house,
        cell: { cx: mgg.cx, cy: mgg.cy },
        mission: mgg.m,
      },
    };
  });
}

async function tsProducedMgg(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const mgg = game.entities.find((e: any) =>
      e.alive !== false &&
      e.type === 'MGG' &&
      e.house === 'GoodGuy' &&
      e.cell?.cx === 26 &&
      e.cell?.cy === 51);
    if (!mgg) throw new Error('TS SCU13EA produced GoodGuy MGG missing');

    return {
      tick: game.tick,
      rngState: state.rngState,
      unit: {
        type: mgg.type,
        house: mgg.house,
        cell: { cx: mgg.cell.cx, cy: mgg.cell.cy },
        mission: mgg.mission === 'GUARD' ? 5 : mgg.mission,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU13 AI factory MGG rate', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('completes and exits GoodGuy MGG on the C++ factory schedule', async () => {
    await withDualScenario('SCU13EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 488);
      const cppFactory = await wasmGoodGuyWeapFactory(handle.wasm);
      const tsFactory = await tsGoodGuyWeapFactory(handle.ts);

      expect(tsFactory.tick).toBe(cppFactory.tick);
      expect(tsFactory.rngState >>> 0).toBe(cppFactory.rngState >>> 0);
      expect(cppFactory.factory).toMatchObject({
        type: 'MGG',
        progress: 54,
        done: true,
      });
      expect(tsFactory.factory).toMatchObject({
        type: cppFactory.factory!.type,
        progress: cppFactory.factory!.progress,
        done: cppFactory.factory!.done,
      });

      await stepBoth(handle, 1);
      const cppMgg = await wasmProducedMgg(handle.wasm);
      const tsMgg = await tsProducedMgg(handle.ts);

      expect(tsMgg.tick).toBe(cppMgg.tick);
      expect(tsMgg.rngState >>> 0).toBe(cppMgg.rngState >>> 0);
      expect(tsMgg.unit).toEqual(cppMgg.unit);

      // On the next building AI tick, WEAP Mission_Unload INITIAL reissues
      // GUARD to the produced unit. C++ preserves the creation-tick guard
      // timer when the unit is already in GUARD; TS must not zero it and force
      // an extra guard scan.
      await stepBoth(handle, 1);
      const cppAfterUnloadInitial = await wasmProducedMgg(handle.wasm);
      const tsAfterUnloadInitial = await tsProducedMgg(handle.ts);

      expect(tsAfterUnloadInitial.tick).toBe(cppAfterUnloadInitial.tick);
      expect(tsAfterUnloadInitial.rngState >>> 0).toBe(cppAfterUnloadInitial.rngState >>> 0);
      expect(tsAfterUnloadInitial.unit).toEqual(cppAfterUnloadInitial.unit);
    }, { wasmSeed: 0 });
  }, 300_000);
});
