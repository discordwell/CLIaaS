/**
 * Dual-runtime check for same-tick projectile submissions.
 *
 * In SCA03EA, two Spain 2TNK shells detonate at tick 472. The second impact
 * causes an ant to submit a Mandible invisible bullet during the same Logic
 * pass. C++ appends that BulletClass after the current cursor and processes it
 * immediately, including Bullet_Explodes' Coord_Scatter RNG. TS must classify
 * that Mandible as a new same-tick Logic object, not as an older projectile
 * shifted into the deleted shell's slot.
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
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
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

async function wasmProjectileSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    return {
      tick: state.tick,
      rngState: state.rngState,
      bullets: (state.bullets ?? []).map((bullet: any) => ({
        type: bullet.type,
        lx: bullet.lx,
        ly: bullet.ly,
        fx: bullet.fx,
        fy: bullet.fy,
        timer: bullet.timer,
        payback: bullet.pb,
      })),
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    bullets: Array<{
      type: string;
      lx: number;
      ly: number;
      fx: number;
      fy: number;
      timer: number;
      payback: number;
    }>;
  }>;
}

async function tsProjectileSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    return {
      tick: state.tick,
      rngState: state.rngState,
      projectiles: ((game?.inflightProjectiles ?? []) as any[]).map(projectile => ({
        weapon: projectile.weapon?.name,
        lx: projectile.logicalLX,
        ly: projectile.logicalLY,
        headToLX: projectile.headToLX,
        headToLY: projectile.headToLY,
        timer: projectile.fuseTimer,
        logicIndexHint: projectile.logicIndexHint,
      })),
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    projectiles: Array<{
      weapon: string;
      lx: number;
      ly: number;
      headToLX: number;
      headToLY: number;
      timer: number;
      logicIndexHint: number;
    }>;
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCA03 same-tick Mandible projectile', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('processes a newly submitted invisible Mandible bullet in the same Logic pass', async () => {
    await withDualScenario('SCA03EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInCppSizedChunks(handle, 471);
      const cppBefore = await wasmProjectileSnapshot(handle.wasm);
      const tsBefore = await tsProjectileSnapshot(handle.ts);

      expect(cppBefore.tick).toBe(471);
      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(cppBefore.bullets).toHaveLength(2);
      expect(tsBefore.projectiles.map(projectile => projectile.weapon)).toEqual(['90mm', '90mm']);

      await stepBoth(handle, 1);
      const cppAfter = await wasmProjectileSnapshot(handle.wasm);
      const tsAfter = await tsProjectileSnapshot(handle.ts);

      expect(cppAfter.tick).toBe(472);
      expect(cppAfter.bullets).toHaveLength(0);
      expect(tsAfter.tick).toBe(cppAfter.tick);
      expect(tsAfter.projectiles).toHaveLength(0);
      expect(tsAfter.rngState >>> 0).toBe(cppAfter.rngState >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
