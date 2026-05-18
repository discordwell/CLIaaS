/**
 * Dual-runtime check for fraidy-cat infantry empty-ammo mission queuing.
 *
 * In SCG27EA, a Greek C1 has MISSION_MOVE with MISSION_ATTACK queued, a live
 * TarCom, one pistol shot left, and enough Fear for Fear_AI to Scatter(0,true).
 * C++ runs:
 *   Mission_Move -> Commence(ATTACK) -> Fear_AI queues MOVE/NavCom
 *   Firing_AI -> Fire_At empties Ammo -> Assign_Mission(GUARD)
 *   Movement_AI starts the scatter driver while Mission is still ATTACK
 *
 * The important bit is Assign_Mission: empty ammo queues GUARD and overwrites
 * the scatter MOVE queue; it does not directly set Mission to GUARD.
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
    const chunk = Math.min(remaining, 900);
    result = await stepBoth(handle, chunk);
    remaining -= chunk;
  }
  if (!result) throw new Error('No step result produced');
  return result;
}

async function wasmC1State(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const c1 = [...(state.units ?? []), ...(state.enemies ?? [])].find((unit: any) =>
      unit.id === 851999 &&
      unit.t === 'C1' &&
      unit.house === 'Greece');
    if (!c1) throw new Error('C++ SCG27EA Greek C1 empty-ammo state missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      c1: {
        mission: c1.m,
        missionTimer: c1.mt,
        missionQueue: c1.mq,
        isDriving: c1.drv,
        doing: c1.doing,
        lx: c1.lx,
        ly: c1.ly,
        arm: c1.arm,
        ammo: c1.ammo,
        primaryCurrent: c1.pf,
        primaryDesired: c1.pfd,
        targetLX: c1.tlx ?? null,
        targetLY: c1.tly ?? null,
        navLX: c1.nlx ?? null,
        navLY: c1.nly ?? null,
        headLX: c1.hlx ?? null,
        headLY: c1.hly ?? null,
        path0: c1.p0,
        fear: c1.fear,
      },
    };
  });
}

async function tsC1State(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const c1 = game.entities.find((entity: any) =>
      entity.type === 'C1' &&
      entity.house === 'Greece' &&
      entity.cell?.cx === 35 &&
      entity.cell?.cy === 42);
    if (!c1) throw new Error('TS SCG27EA Greek C1 empty-ammo state missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      c1: {
        mission: c1.mission,
        missionTimer: c1.missionTimer,
        missionQueue: c1.missionQueue,
        isDriving: c1.isDriving,
        doing: c1.doing,
        lx: c1.leptonX,
        ly: c1.leptonY,
        arm: c1.attackCooldown,
        ammo: c1.ammo,
        primaryCurrent: c1.bodyFacing256,
        primaryDesired: c1.desiredFacing256,
        target: c1.target
          ? { type: c1.target.type, lx: c1.target.leptonX, ly: c1.target.leptonY, hp: c1.target.hp }
          : null,
        moveTarget: c1.moveTarget,
        headLX: c1.headToLX,
        headLY: c1.headToLY,
        path0: c1.path.length > 0 && c1.pathIndex < c1.path.length
          ? { cx: c1.path[c1.pathIndex].cx, cy: c1.path[c1.pathIndex].cy }
          : null,
        fear: c1.fear,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG27 fraidy-cat empty ammo queues GUARD', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps ATTACK active and queues GUARD after the last pistol shot', async () => {
    await withDualScenario('SCG27EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothChunked(handle, 2230);
      const [cppBefore, tsBefore] = await Promise.all([
        wasmC1State(handle.wasm),
        tsC1State(handle.ts),
      ]);

      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(tsBefore.rngState >>> 0).toBe(cppBefore.rngState >>> 0);
      expect(cppBefore.c1).toMatchObject({
        mission: 2,
        missionQueue: 1,
        isDriving: false,
        arm: 0,
        ammo: 1,
        targetLX: 8832,
        targetLY: 10624,
        navLX: null,
      });
      expect(tsBefore.c1).toMatchObject({
        mission: 'MOVE',
        missionQueue: 'ATTACK',
        isDriving: false,
        arm: cppBefore.c1.arm,
        ammo: cppBefore.c1.ammo,
        target: { type: '3TNK', lx: cppBefore.c1.targetLX, ly: cppBefore.c1.targetLY },
        moveTarget: null,
      });

      await stepBothChunked(handle, 1);
      const [cppAfter, tsAfter] = await Promise.all([
        wasmC1State(handle.wasm),
        tsC1State(handle.ts),
      ]);

      expect(tsAfter.tick).toBe(cppAfter.tick);
      expect(tsAfter.rngState >>> 0).toBe(cppAfter.rngState >>> 0);
      expect(cppAfter.c1).toMatchObject({
        mission: 1,
        missionQueue: 5,
        isDriving: true,
        arm: 6,
        ammo: 0,
        fear: 255,
        primaryCurrent: 160,
        primaryDesired: 160,
        navLX: 8840,
        navLY: 11144,
        headLX: 8896,
        headLY: 11072,
        path0: 5,
      });
      expect(tsAfter.c1).toMatchObject({
        mission: 'ATTACK',
        missionQueue: 'GUARD',
        isDriving: true,
        arm: cppAfter.c1.arm,
        ammo: cppAfter.c1.ammo,
        fear: cppAfter.c1.fear,
        primaryCurrent: cppAfter.c1.primaryCurrent,
        primaryDesired: cppAfter.c1.primaryDesired,
        moveTarget: { lx: cppAfter.c1.navLX, ly: cppAfter.c1.navLY },
        headLX: cppAfter.c1.headLX,
        headLY: cppAfter.c1.headLY,
        path0: { cx: 34, cy: 43 },
      });
    }, { wasmSeed: 0 });
  }, 300_000);
});
