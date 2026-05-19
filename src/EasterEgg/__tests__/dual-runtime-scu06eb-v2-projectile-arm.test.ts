/**
 * Dual-runtime regression for FuseClass::Arm_Fuse on FROG/SCUD bullets.
 *
 * SCU06EB exposes a V2 rocket whose FROG projectile passes close to infantry
 * before its Arm=10 delay expires. C++ keeps the bullet alive and the infantry
 * moving until the armed fuse detonates later; TS used to leave every projectile
 * with armingTimer=0 and detonated on the early proximity pass.
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

async function stepBothOneTickAtATime(
  handle: Parameters<typeof stepBoth>[0],
  ticks: number,
): Promise<Awaited<ReturnType<typeof stepBoth>>> {
  let result: Awaited<ReturnType<typeof stepBoth>> | null = null;
  for (let i = 0; i < ticks; i++) {
    result = await stepBoth(handle, 1);
  }
  if (!result) throw new Error('No ticks stepped');
  return result;
}

async function wasmProjectileArmSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const rifle = (state.logicLayer ?? []).find((row: any[]) =>
      row[6] === 851975 || (row[0] === 96 && row[1] === 'E1' && row[2] === 'USSR'));
    const frogs = ((state.bullets ?? []) as any[])
      .filter((bullet) => bullet.type === 'FROG')
      .map((bullet) => ({
        lx: bullet.lx,
        ly: bullet.ly,
        targetLX: bullet.fx,
        targetLY: bullet.fy,
        timer: bullet.timer,
      }));

    return {
      tick: state.tick,
      rngState: state.rngState,
      rifle: rifle ? {
        alive: rifle[14] > 0,
        mission: rifle[7],
        missionTimer: rifle[8],
        hp: rifle[14],
        lx: rifle[12],
        ly: rifle[13],
      } : null,
      frogs,
    };
  });
}

async function tsProjectileArmSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const rifle = game.entities.find((entity: any) =>
      entity.type === 'E1' &&
      entity.house === 'USSR' &&
      (entity.logicIndexHint === 96 || entity.id === 72));
    const scuds = ((game.inflightProjectiles ?? []) as any[])
      .filter((projectile) => projectile.weapon?.name === 'SCUD')
      .map((projectile) => ({
        lx: projectile.logicalLX,
        ly: projectile.logicalLY,
        targetLX: projectile.headToLX,
        targetLY: projectile.headToLY,
        timer: projectile.fuseTimer,
        armingTimer: projectile.armingTimer,
      }));

    return {
      tick: game.tick,
      rngState: state.rngState,
      rifle: rifle ? {
        alive: rifle.alive !== false,
        mission: rifle.mission,
        missionTimer: rifle.missionTimer,
        hp: rifle.hp,
        lx: rifle.leptonX,
        ly: rifle.leptonY,
      } : null,
      scuds,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU06EB V2 FROG projectile arming', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the SCUD projectile armed-delayed through the early proximity pass', async () => {
    await withDualScenario('SCU06EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothOneTickAtATime(handle, 1083);
      const beforeCpp = await wasmProjectileArmSnapshot(handle.wasm);
      const beforeTs = await tsProjectileArmSnapshot(handle.ts);
      expect(beforeCpp.frogs.length).toBeGreaterThan(0);
      expect(beforeTs.scuds.length).toBeGreaterThan(0);

      await stepBoth(handle, 1);
      const cpp1084 = await wasmProjectileArmSnapshot(handle.wasm);
      const ts1084 = await tsProjectileArmSnapshot(handle.ts);

      expect(cpp1084, 'C++ FROG is still unexpired at the tick-1084 proximity pass').toMatchObject({
        tick: 1084,
        rifle: {
          alive: true,
          hp: 9,
          lx: 11446,
          ly: 15946,
        },
      });
      expect(cpp1084.frogs.length).toBeGreaterThan(0);
      expect(ts1084, 'TS should keep the same armed SCUD and not kill the infantry early').toMatchObject({
        tick: 1084,
        rifle: {
          alive: true,
          hp: cpp1084.rifle!.hp,
          lx: cpp1084.rifle!.lx,
          ly: cpp1084.rifle!.ly,
        },
      });
      expect(ts1084.scuds.length).toBeGreaterThan(0);
      expect(ts1084.scuds[0].armingTimer).toBeGreaterThanOrEqual(0);

      await stepBoth(handle, 4);
      const cpp1088 = await wasmProjectileArmSnapshot(handle.wasm);
      const ts1088 = await tsProjectileArmSnapshot(handle.ts);
      expect(cpp1088.rifle).toMatchObject({ alive: false, hp: 0 });
      expect(ts1088.rifle).toMatchObject({
        alive: false,
        hp: cpp1088.rifle!.hp,
        lx: cpp1088.rifle!.lx,
        ly: cpp1088.rifle!.ly,
      });
    }, { preserveSourceFog: true });
  }, 300_000);
});
