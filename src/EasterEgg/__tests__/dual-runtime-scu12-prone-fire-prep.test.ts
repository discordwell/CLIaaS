/**
 * Dual-runtime check for infantry fire prep while going prone.
 *
 * In SCU12EA an USSR E2 at (36,40) acquires a target while DO_LIE_DOWN is still
 * active. C++ does not latch IsFiring during the non-interruptible lie-down
 * action; it waits until DO_PRONE can transition to DO_FIRE_PRONE, then launches
 * the grenade at tick 242. TS must not permanently pin firePrep to the completed
 * lie-down stage.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type ParityServerHandle,
  type DualStepResult,
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

async function stepBothOneTickAtATime(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<DualStepResult> {
  let result: DualStepResult | null = null;
  for (let i = 0; i < ticks; i++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('No step result produced');
  return result;
}

async function wasmProneFireState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const e2 = (state.logicLayer ?? []).find((row: any[]) => row[6] === 852026);
    const grenade = (state.bullets ?? []).find((bullet: any) => bullet.pb === 852026);
    if (!e2) throw new Error('C++ SCU12EA E2 aid 852026 missing');
    if (!grenade) throw new Error('C++ SCU12EA E2 grenade missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      e2: {
        mission: e2[7],
        missionTimer: e2[8],
        doing: e2[11],
        arm: e2[23],
        fireX: e2[34],
        fireY: e2[35],
        canFire: e2[37],
      },
      grenade,
    };
  });
}

async function tsProneFireState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const e2 = game.entities.find((entity: any) =>
      entity.type === 'E2' &&
      entity.house === 'USSR' &&
      entity.leptonX === 9408 &&
      entity.leptonY === 10432);
    if (!e2) throw new Error('TS SCU12EA E2 at (36,40) missing');
    const grenade = game.inflightProjectiles.find((projectile: any) =>
      projectile.attackerId === e2.id &&
      projectile.weapon?.name === 'Grenade');
    if (!grenade) throw new Error('TS SCU12EA E2 grenade missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      e2: {
        mission: e2.mission,
        missionTimer: e2.missionTimer,
        doing: e2.doing,
        doingStage: e2.doingStage,
        firePrepActive: e2.firePrepActive,
        arm: e2.attackCooldown,
        targetId: e2.target?.id ?? null,
      },
      grenade: {
        weapon: grenade.weapon?.name,
        currentFrame: grenade.currentFrame,
        travelFrames: grenade.travelFrames,
        fuseTimer: grenade.fuseTimer,
        logicalLX: grenade.logicalLX,
        logicalLY: grenade.logicalLY,
        headToLX: grenade.headToLX,
        headToLY: grenade.headToLY,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU12 prone infantry fire prep', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('waits for DO_FIRE_PRONE before launching a grenade from a prone E2', async () => {
    await withDualScenario('SCU12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 242);
      const [cpp, ts] = await Promise.all([
        wasmProneFireState(handle.wasm),
        tsProneFireState(handle.ts),
      ]);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);

      expect(cpp.e2.mission).toBe(5); // MISSION_GUARD
      expect(cpp.e2.doing).toBe(8); // DO_FIRE_PRONE
      expect(cpp.e2.canFire).toBe(3); // FIRE_OK, now rearming
      expect(ts.e2.mission).toBe('GUARD');
      expect(ts.e2.doing).toBe('fire');
      expect(ts.e2.doingStage).toBe(6);
      expect(ts.e2.firePrepActive).toBe(false);
      expect(ts.e2.arm).toBe(cpp.e2.arm);

      expect(ts.grenade.weapon).toBe('Grenade');
      expect(ts.grenade.currentFrame).toBe(1);
      expect(ts.grenade.fuseTimer).toBe(cpp.grenade.timer);
      expect(ts.grenade.logicalLX).toBe(cpp.grenade.lx);
      expect(ts.grenade.logicalLY).toBe(cpp.grenade.ly);
      expect(ts.grenade.headToLX).toBe(cpp.grenade.tx);
      expect(ts.grenade.headToLY).toBe(cpp.grenade.ty);
    }, { wasmSeed: 0 });
  }, 300_000);
});
