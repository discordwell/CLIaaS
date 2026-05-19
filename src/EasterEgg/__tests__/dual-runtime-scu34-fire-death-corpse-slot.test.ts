/**
 * Dual-runtime check for infantry fire-death corpse AnimClass allocation.
 *
 * C++ infantry.cpp creates CORPSE1/2/3 after gun, explosion, and grenade
 * deaths, but DO_FIRE_DEATH deletes the infantry without a follow-up corpse
 * AnimClass. In SCU34EA a flame-turret burn death completes at tick 437; if TS
 * reserves a C++ corpse Logic slot for it, later FB2/NAPALM fire logic shifts
 * and RNG diverges when FB2 processes at tick 583.
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

async function stepBothInChunks(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 900);
    await stepBoth(handle, chunk);
    remaining -= chunk;
  }
}

async function wasmAnimState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const nearbyAnims = ((state.anims ?? []) as any[])
      .filter(anim => anim.cx === 87 && anim.cy === 40 && anim.logicIndex >= 270 && anim.logicIndex <= 285)
      .map(anim => ({
        logicIndex: anim.logicIndex,
        name: anim.name,
        stage: anim.stage,
        loops: anim.loops,
      }))
      .sort((a, b) => a.logicIndex - b.logicIndex);

    return {
      tick: state.tick,
      rngState: state.rngState,
      nearbyAnims,
    };
  });
}

async function tsAnimState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const cellSize = 24;
    const corpses = ((game?.corpses ?? []) as any[])
      .map(corpse => ({
        logicIndex: corpse.logicIndexHint ?? null,
        type: corpse.type,
        deathVariant: corpse.deathVariant,
        cx: Math.floor((corpse.x ?? 0) / cellSize),
        cy: Math.floor((corpse.y ?? 0) / cellSize),
        cppAnimStartTick: corpse.cppAnimStartTick ?? null,
        cppLogicReleased: corpse.cppLogicReleased === true,
      }))
      .filter(corpse => corpse.logicIndex !== null || !corpse.cppLogicReleased);
    const nearbyAnims = ((game?.logicAnims ?? []) as any[])
      .filter(anim => anim.logicIndexHint >= 270 && anim.logicIndexHint <= 285)
      .map(anim => ({
        logicIndex: anim.logicIndexHint,
        type: anim.type,
        stage: anim.stage,
        loops: anim.loops,
      }))
      .sort((a, b) => a.logicIndex - b.logicIndex);

    return {
      tick: state.tick,
      rngState: state.rngState,
      corpses,
      nearbyAnims,
    };
  });
}

async function wasmGreeceE1State(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const allUnits = [...(state.units ?? []), ...(state.enemies ?? [])];
    const e1 = allUnits.find((unit: any) => unit.id === 851973);
    if (!e1) throw new Error('C++ SCU34EA Greece E1 id 851973 missing');
    return {
      tick: state.tick,
      lx: e1.lx,
      ly: e1.ly,
      mission: e1.m,
      missionTimer: e1.mt,
      isDriving: e1.drv,
      doing: e1.doing,
      firing: e1.firing,
      arm: e1.arm,
      headToLX: e1.hlx ?? null,
      headToLY: e1.hly ?? null,
    };
  });
}

async function tsGreeceE1State(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const e1 = game.entities.find((entity: any) => entity.id === 109);
    if (!e1) throw new Error('TS SCU34EA Greece E1 id 109 missing');
    return {
      tick: state.tick,
      lx: e1.leptonX,
      ly: e1.leptonY,
      mission: e1.mission,
      missionTimer: e1.missionTimer,
      isDriving: e1.isDriving,
      doing: e1.doing,
      firePrepActive: e1.firePrepActive,
      isFiringAnim: e1.isFiringAnim,
      arm: e1.attackCooldown,
      headToLX: e1.headToLX || null,
      headToLY: e1.headToLY || null,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU34 fire-death corpse slots', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not reserve a C++ corpse Logic slot after DO_FIRE_DEATH', async () => {
    await withDualScenario('SCU34EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 549);
      const cppE1 = await wasmGreeceE1State(handle.wasm);
      const tsE1 = await tsGreeceE1State(handle.ts);
      expect(tsE1.tick).toBe(cppE1.tick);
      expect(cppE1).toMatchObject({
        lx: 22400,
        ly: 10368,
        mission: 14,
        missionTimer: 14,
        isDriving: true,
        doing: 3,
        firing: false,
        arm: 19,
        headToLX: 22592,
        headToLY: 10176,
      });
      expect(tsE1).toMatchObject({
        lx: 22400,
        ly: 10368,
        mission: 'HUNT',
        missionTimer: 14,
        isDriving: true,
        doing: 'walk',
        firePrepActive: false,
        isFiringAnim: false,
        arm: 19,
        headToLX: 22592,
        headToLY: 10176,
      });

      await stepBothInChunks(handle, 33);
      const cpp = await wasmAnimState(handle.wasm);
      const ts = await tsAnimState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.nearbyAnims.map(anim => [anim.logicIndex, anim.name])).toEqual([
        [274, 'FIRE3'],
        [276, 'FIRE3'],
        [277, 'FB2'],
        [278, 'NAPALM3'],
      ]);
      expect(ts.corpses).not.toContainEqual(expect.objectContaining({
        deathVariant: 4,
        logicIndex: 274,
      }));
      expect(ts.nearbyAnims).toEqual(expect.arrayContaining([
        expect.objectContaining({ logicIndex: 274, type: 'fire_small' }),
        expect.objectContaining({ logicIndex: 276, type: 'fire_small' }),
        expect.objectContaining({ logicIndex: 277, type: 'fball_fade' }),
        expect.objectContaining({ logicIndex: 278, type: 'napalm3' }),
      ]));

      await stepBoth(handle, 1);
      const postCpp = await wasmAnimState(handle.wasm);
      const postTs = await tsAnimState(handle.ts);
      expect(postTs.tick).toBe(postCpp.tick);
      expect(postTs.rngState >>> 0).toBe(postCpp.rngState >>> 0);
    });
  }, 80_000);
});
