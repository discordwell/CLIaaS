/**
 * Dual-runtime check for duplicate BulletClass Logic hints after vector compaction.
 *
 * SCG07EA tick 169 has a torpedo and a fireball with the same effective TS
 * Logic hint. C++ still advances the fireball in that frame; the duplicate
 * hint is not itself evidence that an object shifted behind the active cursor.
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

async function wasmFireballState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const fireball = (state.bullets ?? []).find((bullet: any) =>
      bullet.type === 'Fireball' && bullet.lx === 7252 && bullet.ly === 15090);
    if (!fireball) throw new Error('C++ SCG07EA tick-169 Fireball missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      fireball: {
        lx: fireball.lx,
        ly: fireball.ly,
        timer: fireball.timer,
        pb: fireball.pb,
      },
    };
  });
}

async function tsFlamerState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const flamer = game.inflightProjectiles.find((projectile: any) =>
      projectile.weapon?.name === 'Flamer' &&
      projectile.headToLX === 7040 &&
      projectile.headToLY === 14976);
    if (!flamer) throw new Error('TS SCG07EA tick-169 Flamer missing');

    return {
      tick: state.tick,
      rngState: state.rngState,
      flamer: {
        logicalLX: flamer.logicalLX,
        logicalLY: flamer.logicalLY,
        currentFrame: flamer.currentFrame,
        fuelTimer: flamer.fuelTimer,
        logicIndexHint: flamer.logicIndexHint,
      },
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG07 duplicate projectile hints', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('advances a same-hint Fireball after a TorpTube deletes without removing earlier Logic predecessors', async () => {
    await withDualScenario('SCG07EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBoth(handle, 169);
      const cpp = await wasmFireballState(handle.wasm);
      const ts = await tsFlamerState(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);

      expect(ts.flamer.currentFrame).toBe(18);
      expect(ts.flamer.fuelTimer).toBe(cpp.fireball.timer);
      expect(ts.flamer.logicalLX).toBe(cpp.fireball.lx);
      expect(ts.flamer.logicalLY).toBe(cpp.fireball.ly);
      expect(ts.flamer.logicIndexHint).toBe(188);
    }, { wasmSeed: 0 });
  }, 300_000);
});
