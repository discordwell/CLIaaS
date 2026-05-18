/**
 * Dual-runtime check for same-tick BulletClass cursor shifts.
 *
 * SCG04EA tick 1287 creates two invisible bullets before the first bullet's
 * impact destroys an MCV. C++ deletes the MCV logic slot and increments the
 * Logic cursor, so the second bullet shifts behind the cursor and remains
 * pending until the next frame. TS used to exempt all current-tick bullets from
 * shift skips, detonating the Pistol bullet immediately and scattering its E1
 * target one tick early.
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

async function wasmShiftedPistolState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const e1Row = (state.logicLayer ?? []).find((row: any[]) =>
      row[1] === 'E1' &&
      row[2] === 'BadGuy' &&
      row[3] === 88 &&
      row[4] === 51);
    const bullet = (state.bullets ?? []).find((candidate: any) =>
      candidate.type === 'Invisible' &&
      candidate.lx === 22592 &&
      candidate.ly === 13120 &&
      candidate.fx === 22592 &&
      candidate.fy === 13120 &&
      candidate.str === 1);
    if (!e1Row) throw new Error('C++ SCG04EA Pistol target E1 missing');
    if (!bullet) throw new Error('C++ SCG04EA shifted Pistol bullet missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      targetHp: e1Row[14],
      bullet: {
        lx: bullet.lx,
        ly: bullet.ly,
        timer: bullet.timer,
        strength: bullet.str,
        warhead: bullet.wh,
      },
    };
  });
}

async function tsShiftedPistolState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const e1 = game.entities.find((entity: any) =>
      entity.type === 'E1' &&
      entity.house === 'BadGuy' &&
      entity.cell?.cx === 88 &&
      entity.cell?.cy === 51);
    const projectile = game.inflightProjectiles.find((candidate: any) =>
      candidate.weapon?.name === 'Pistol' &&
      candidate.headToLX === 22592 &&
      candidate.headToLY === 13120 &&
      candidate.strength === 1);
    if (!e1) {
      const nearby = game.entities
        .filter((entity: any) =>
          entity.house === 'BadGuy' &&
          Math.abs((entity.cell?.cx ?? -999) - 88) <= 2 &&
          Math.abs((entity.cell?.cy ?? -999) - 51) <= 3)
        .map((entity: any) => `${entity.type}@${entity.cell?.cx},${entity.cell?.cy}/hp${entity.hp}`)
        .join('; ');
      throw new Error(`TS SCG04EA Pistol target E1 missing; nearby=${nearby}`);
    }
    if (!projectile) {
      const projectiles = game.inflightProjectiles
        .map((candidate: any) => `${candidate.weapon?.name}@${candidate.headToLX},${candidate.headToLY}/f${candidate.currentFrame}/t${candidate.fuseTimer}`)
        .join('; ');
      throw new Error(`TS SCG04EA shifted Pistol projectile missing; projectiles=${projectiles}`);
    }
    return {
      tick: state.tick,
      rngState: state.rngState,
      targetHp: e1.hp,
      projectile: {
        lx: projectile.logicalLX,
        ly: projectile.logicalLY,
        currentFrame: projectile.currentFrame,
        fuseTimer: projectile.fuseTimer,
        strength: projectile.strength,
        logicIndexHint: projectile.logicIndexHint,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG04 current-tick bullet shift', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('leaves a current-tick Pistol bullet pending when an earlier detonation shifts it behind the Logic cursor', async () => {
    await withDualScenario('SCG04EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      const result = await stepBothInCppSizedChunks(handle, 1287);
      const cpp = await wasmShiftedPistolState(handle.wasm);
      const ts = await tsShiftedPistolState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(cpp.tick).toBe(1287);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);

      expect(cpp.targetHp).toBe(39);
      expect(ts.targetHp).toBe(cpp.targetHp);

      expect(cpp.bullet).toMatchObject({
        lx: 22592,
        ly: 13120,
        timer: 4,
        strength: 1,
        warhead: 0,
      });
      expect(ts.projectile).toMatchObject({
        lx: cpp.bullet.lx,
        ly: cpp.bullet.ly,
        currentFrame: 0,
        fuseTimer: cpp.bullet.timer,
        strength: cpp.bullet.strength,
      });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
