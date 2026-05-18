/**
 * Dual-runtime check for BulletClass logic cursor parity.
 *
 * In SCU09EA, a 90mm shell detonates at tick 368 and removes an earlier Logic
 * object. C++ DynamicVectorClass then increments the Logic cursor, so the 105mm
 * shell shifted into that slot is skipped until the next tick. TS must preserve
 * that cursor behavior; otherwise the 105mm impact lands one tick early and
 * kills a Greek E1 before its tick-373 Hunt AI.
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

async function wasm105mm(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const bullet = (state.bullets ?? []).find((candidate: any) =>
      candidate.type === 'Cannon' &&
      candidate.pb === 1835023 &&
      candidate.fx === 25408 &&
      candidate.fy === 24128);
    if (!bullet) throw new Error('C++ 105mm shell from 3TNK#1835023 is missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      lx: bullet.lx,
      ly: bullet.ly,
      timer: bullet.timer,
      max: bullet.max,
      payback: bullet.pb,
      targetLX: bullet.fx,
      targetLY: bullet.fy,
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    lx: number;
    ly: number;
    timer: number;
    max: number;
    payback: number;
    targetLX: number;
    targetLY: number;
  }>;
}

async function ts105mm(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const projectiles = ((game?.inflightProjectiles ?? []) as any[])
      .filter(projectile =>
        projectile.weapon?.name === '105mm' &&
        projectile.headToLX === 25408 &&
        projectile.headToLY === 24128)
      .sort((a, b) => (a.fuseTimer ?? 0) - (b.fuseTimer ?? 0));
    const projectile = projectiles[0];
    if (!projectile) throw new Error('TS 105mm shell aimed at E1 cell is missing');
    return {
      tick: state.tick,
      rngState: state.rngState,
      lx: projectile.logicalLX,
      ly: projectile.logicalLY,
      timer: projectile.fuseTimer,
      currentFrame: projectile.currentFrame,
      logicIndexHint: projectile.logicIndexHint,
      targetLX: projectile.headToLX,
      targetLY: projectile.headToLY,
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    lx: number;
    ly: number;
    timer: number;
    currentFrame: number;
    logicIndexHint: number;
    targetLX: number;
    targetLY: number;
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU09 projectile logic shift skip', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('does not advance a shell shifted into a deleted Logic slot during the same pass', async () => {
    await withDualScenario('SCU09EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInCppSizedChunks(handle, 367);
      const cppBefore = await wasm105mm(handle.wasm);
      const tsBefore = await ts105mm(handle.ts);

      expect(cppBefore.tick).toBe(367);
      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(tsBefore.lx).toBe(cppBefore.lx);
      expect(tsBefore.ly).toBe(cppBefore.ly);
      expect(tsBefore.timer).toBe(cppBefore.timer);
      expect(cppBefore.timer).toBe(8);

      await stepBoth(handle, 1);
      const cppAfter = await wasm105mm(handle.wasm);
      const tsAfter = await ts105mm(handle.ts);

      expect(cppAfter.tick).toBe(368);
      expect(cppAfter.lx).toBe(cppBefore.lx);
      expect(cppAfter.ly).toBe(cppBefore.ly);
      expect(cppAfter.timer).toBe(cppBefore.timer);

      expect(tsAfter.tick).toBe(cppAfter.tick);
      expect(tsAfter.lx).toBe(cppAfter.lx);
      expect(tsAfter.ly).toBe(cppAfter.ly);
      expect(tsAfter.timer).toBe(cppAfter.timer);
      expect(tsAfter.rngState >>> 0).toBe(cppAfter.rngState >>> 0);
    }, { wasmSeed: 0 });
  }, 300_000);
});
