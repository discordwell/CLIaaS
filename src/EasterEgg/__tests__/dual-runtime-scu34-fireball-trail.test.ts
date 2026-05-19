/**
 * Dual-runtime check for structure-fired Fireball projectile trails.
 *
 * In SCU34EA, a Greece flame turret fires a FireballLauncher projectile at the
 * Soviet armor group. C++ treats the Fireball projectile's Animates=yes flag as
 * BulletClass::IsFlameEquipped and appends FB2 trail AnimClass objects every
 * other bullet AI tick. TS must create the same logic anims for structure-fired
 * fireballs; otherwise later Logic index shifts and RNG-consuming anim/fire
 * effects diverge.
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

async function wasmFireballTrailState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const fb2Anims = (state.anims ?? [])
      .filter((anim: any) => anim.name === 'FB2')
      .map((anim: any) => ({
        logicIndex: anim.logicIndex,
        stage: anim.stage,
        loops: anim.loops,
        lx: anim.lx,
        ly: anim.ly,
      }));
    const fireballBullets = (state.bullets ?? [])
      .filter((bullet: any) => bullet.type === 'Fireball')
      .map((bullet: any) => ({
        lx: bullet.lx,
        ly: bullet.ly,
        timer: bullet.timer,
      }));

    return {
      tick: state.tick,
      rngState: state.rngState,
      fb2Anims,
      fireballBullets,
    };
  });
}

async function tsFireballTrailState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const fballFadeAnims = ((game?.logicAnims ?? []) as any[])
      .filter(anim => anim.type === 'fball_fade')
      .map(anim => ({
        logicIndex: anim.logicIndexHint,
        stage: anim.stage,
        loops: anim.loops,
        lx: Math.round((anim.x ?? 0) * 256 / 24),
        ly: Math.round((anim.y ?? 0) * 256 / 24),
      }));
    const fireballProjectiles = ((game?.inflightProjectiles ?? []) as any[])
      .filter(projectile => projectile.weapon?.name === 'FireballLauncher')
      .map(projectile => ({
        logicIndex: projectile.logicIndexHint,
        lx: projectile.logicalLX,
        ly: projectile.logicalLY,
        timer: projectile.fuseTimer,
        flameTrailAnim: projectile.flameTrailAnim,
        isFlameEquipped: projectile.isFlameEquipped,
      }));

    return {
      tick: state.tick,
      rngState: state.rngState,
      fballFadeAnims,
      fireballProjectiles,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU34 Fireball trail anims', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('creates FB2/fball_fade logic anims for the flame-turret fireball in flight', async () => {
    await withDualScenario('SCU34EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInChunks(handle, 246);
      const cpp = await wasmFireballTrailState(handle.wasm);
      const ts = await tsFireballTrailState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(cpp.fireballBullets).toHaveLength(1);
      expect(ts.fireballProjectiles).toHaveLength(1);
      expect(ts.fireballProjectiles[0]).toMatchObject({
        flameTrailAnim: 'fball_fade',
        isFlameEquipped: true,
      });

      expect(cpp.fb2Anims.length).toBeGreaterThanOrEqual(3);
      expect(ts.fballFadeAnims).toHaveLength(cpp.fb2Anims.length);
      expect(ts.fballFadeAnims.map(anim => anim.stage))
        .toEqual(cpp.fb2Anims.map(anim => anim.stage));
    });
  }, 60_000);
});
