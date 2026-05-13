/**
 * Dual-runtime check for UnitClass::AI running DriveClass::AI after ATTACK.
 *
 * C++ UnitClass::AI always calls DriveClass::AI after MissionClass::AI. In
 * SCU10EA a BadGuy 3TNK is in MISSION_ATTACK with a live NavCom/path toward
 * its target; when Mission_Attack's timer fires, DriveClass::AI still rotates
 * the hull that same tick and starts the track on schedule. Skipping the
 * post-handler drive pass leaves TS one rotation tick late and eventually
 * misses Mission_Move's RNG dispatch.
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
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmBadGuyAttackTank(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const tank = [...(state.units ?? []), ...(state.enemies ?? [])]
      .find((u: any) => u.id === 1835021);
    if (!tank) throw new Error('C++ SCU10EA BadGuy 3TNK not found');
    return {
      tick: state.tick,
      cx: tank.cx,
      cy: tank.cy,
      lx: tank.lx,
      ly: tank.ly,
      mission: tank.m,
      missionQueue: tank.mq,
      missionTimer: tank.mt,
      isDriving: tank.drv === true,
      headToLX: tank.hlx ?? 0,
      headToLY: tank.hly ?? 0,
    };
  }, undefined);
}

async function tsBadGuyAttackTank(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const tank = game.entities.find((e: any) => e.id === 93);
    if (!tank) throw new Error('TS SCU10EA BadGuy 3TNK not found');
    return {
      tick: game.tick,
      cx: tank.cell.cx,
      cy: tank.cell.cy,
      lx: tank.leptonX,
      ly: tank.leptonY,
      mission: tank.mission,
      missionQueue: tank.missionQueue,
      missionTimer: tank.missionTimer,
      isDriving: tank.isDriving === true,
      headToLX: tank.headToLX,
      headToLY: tank.headToLY,
    };
  }, undefined);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU10 attack DriveClass re-entry', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('continues DriveClass rotation/movement after a vehicle Mission_Attack timer fires', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 314);
      const cpp314 = await wasmBadGuyAttackTank(handle.wasm);
      const ts314 = await tsBadGuyAttackTank(handle.ts);

      expect(ts314).toEqual({
        ...cpp314,
        mission: 'ATTACK',
        missionQueue: null,
      });
      expect(cpp314.mission).toBe(1);
      expect(cpp314.missionQueue).toBe(-1);

      await stepBoth(handle, 19);
      const cpp333 = await wasmBadGuyAttackTank(handle.wasm);
      const ts333 = await tsBadGuyAttackTank(handle.ts);

      expect(ts333).toEqual({
        ...cpp333,
        mission: 'MOVE',
        missionQueue: null,
      });
      expect(cpp333.mission).toBe(2);
      expect(cpp333.missionQueue).toBe(-1);
    }, { wasmSeed: 0 });
  }, 180_000);
});
