/**
 * Dual-runtime check for C++ homing projectile launch facing.
 *
 * SCU03EA has two Greek E3s firing Dragon missiles at the northern base.
 * C++ launches homing bullets in Fire_Direction() and lets BulletClass rotate
 * toward TarCom; it does not initialize the missile facing directly to the
 * target vector. That first-turn path decides whether the left missile reaches
 * proximity range on tick 202 or tick 203.
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

async function wasmLeftDragonSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate((target) => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const bullet = (state.bullets ?? []).find((b: any) =>
      b.type === 'HeatSeeker' && b.fx === target.lx && b.fy === target.ly);
    return {
      tick: state.tick,
      bullet: bullet ? {
        lx: bullet.lx,
        ly: bullet.ly,
        timer: bullet.timer,
        maxSpeed: bullet.max,
        payback: bullet.pb,
      } : null,
    };
  }, { lx: 18560, ly: 8064 });
}

async function tsLeftDragonSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate((target) => {
    const game = (window as any).__agentGame;
    const projectile = (game.inflightProjectiles ?? []).find((p: any) =>
      p.weapon?.name === 'Dragon' && p.headToLX === target.lx && p.headToLY === target.ly);
    return {
      tick: game.tick,
      projectile: projectile ? {
        logicalLX: projectile.logicalLX,
        logicalLY: projectile.logicalLY,
        currentFrame: projectile.currentFrame,
        fuseTimer: projectile.fuseTimer,
        speedAdd: projectile.speedAdd,
        facing256: projectile.facing256,
        desiredFacing256: projectile.desiredFacing256,
      } : null,
    };
  }, { lx: 18560, ly: 8064 });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU03 homing launch facing', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps the E3 Dragon missile on the C++ launch and proximity path', async () => {
    await withDualScenario('SCU03EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 188);
      const cpp188 = await wasmLeftDragonSnapshot(handle.wasm);
      const ts188 = await tsLeftDragonSnapshot(handle.ts);
      expect(ts188.tick).toBe(cpp188.tick);
      expect(cpp188.bullet).not.toBeNull();
      expect(ts188.projectile).not.toBeNull();
      expect(ts188.projectile!.logicalLX).toBe(cpp188.bullet!.lx);
      expect(ts188.projectile!.logicalLY).toBe(cpp188.bullet!.ly);
      expect(ts188.projectile!.speedAdd).toBe(cpp188.bullet!.maxSpeed);

      await stepBoth(handle, 14);
      const cpp202 = await wasmLeftDragonSnapshot(handle.wasm);
      const ts202 = await tsLeftDragonSnapshot(handle.ts);
      expect(ts202.tick).toBe(cpp202.tick);
      expect(cpp202.bullet).not.toBeNull();
      expect(ts202.projectile).not.toBeNull();
      expect(ts202.projectile!.logicalLX).toBe(cpp202.bullet!.lx);
      expect(ts202.projectile!.logicalLY).toBe(cpp202.bullet!.ly);
      expect(ts202.projectile!.fuseTimer).toBe(cpp202.bullet!.timer);
    }, { wasmSeed: 0 });
  }, 180_000);
});
