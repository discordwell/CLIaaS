/**
 * Dual-runtime check for fixed-wing Mission_Hunt rearm timer exposure.
 *
 * In SCU12EA a BadGuy MIG fires a two-shot Maverick volley while already in
 * DROP_BOMBS. C++ returns the full Arm delay from Mission_Hunt, but the CDTimer
 * frame tick exposes Arm-1 in the post-step state. TS must expose the same
 * post-frame timer so the next volley happens on the C++ tick.
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

async function wasmMig299State(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === 299);
    if (!row) throw new Error('C++ SCU12EA MIG logic index 299 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      mig: {
        logicIndex: row[0],
        type: row[1],
        house: row[2],
        aid: row[6],
        mission: row[7],
        missionTimer: row[8],
        arm: row[23],
        status: row[27],
        lx: row[12],
        ly: row[13],
      },
      bullets: (state.bullets ?? [])
        .filter((bullet: any) => bullet.pb === row[6])
        .map((bullet: any) => ({
          type: bullet.type,
          lx: bullet.lx,
          ly: bullet.ly,
          fuseTarget: { lx: bullet.fx, ly: bullet.fy },
          timer: bullet.timer,
        })),
    };
  });
}

async function tsMig299State(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const mig = game.entities.find((entity: any) =>
      entity.type === 'MIG' &&
      entity.house === 'BadGuy' &&
      entity.logicIndexHint === 299);
    if (!mig) throw new Error('TS SCU12EA MIG logic index 299 missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      mig: {
        id: mig.id,
        logicIndex: mig.logicIndexHint,
        type: mig.type,
        house: mig.house,
        mission: mig.mission,
        missionTimer: mig.missionTimer,
        attackCooldown: mig.attackCooldown,
        status: mig.aircraftAttackStatus,
        lx: mig.leptonX,
        ly: mig.leptonY,
      },
      projectiles: (game.inflightProjectiles ?? [])
        .filter((projectile: any) => projectile.attackerId === mig.id)
        .map((projectile: any) => ({
          weapon: projectile.weapon?.name,
          lx: projectile.logicalLX,
          ly: projectile.logicalLY,
          fuseTarget: { lx: projectile.headToLX, ly: projectile.headToLY },
          timer: projectile.fuseTimer,
        })),
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU12 fixed-wing rearm timer', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('exposes Arm-1 after a two-shot MIG volley so the next volley fires on time', async () => {
    await withDualScenario('SCU12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 136);
      const firstCpp = await wasmMig299State(handle.wasm);
      const firstTs = await tsMig299State(handle.ts);

      expect(firstTs.tick).toBe(firstCpp.tick);
      expect(firstTs.rngState >>> 0).toBe(firstCpp.rngState >>> 0);
      expect(firstCpp.mig).toMatchObject({
        type: 'MIG',
        house: 'BadGuy',
        mission: 1,
        status: 3,
        missionTimer: 2,
        arm: 2,
      });
      expect(firstTs.mig).toMatchObject({
        type: firstCpp.mig.type,
        house: firstCpp.mig.house,
        mission: 'ATTACK',
        status: firstCpp.mig.status,
        missionTimer: firstCpp.mig.missionTimer,
        attackCooldown: firstCpp.mig.arm,
        lx: firstCpp.mig.lx,
        ly: firstCpp.mig.ly,
      });
      expect(firstCpp.bullets).toHaveLength(2);
      expect(firstTs.projectiles).toHaveLength(2);

      await stepBoth(handle, 3);
      const secondCpp = await wasmMig299State(handle.wasm);
      const secondTs = await tsMig299State(handle.ts);

      expect(secondTs.tick).toBe(secondCpp.tick);
      expect(secondTs.rngState >>> 0).toBe(secondCpp.rngState >>> 0);
      expect(secondCpp.mig).toMatchObject({
        type: 'MIG',
        house: 'BadGuy',
        mission: 1,
        status: 3,
        missionTimer: 2,
        arm: 2,
      });
      expect(secondTs.mig).toMatchObject({
        type: secondCpp.mig.type,
        house: secondCpp.mig.house,
        mission: 'ATTACK',
        status: secondCpp.mig.status,
        missionTimer: secondCpp.mig.missionTimer,
        attackCooldown: secondCpp.mig.arm,
        lx: secondCpp.mig.lx,
        ly: secondCpp.mig.ly,
      });
      expect(secondCpp.bullets).toHaveLength(4);
      expect(secondTs.projectiles).toHaveLength(4);
    }, { wasmSeed: 0 });
  }, 300_000);
});
