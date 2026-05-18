/**
 * Dual-runtime check for CellClass::Reduce_Wall damaged wall retention.
 *
 * In SCU12EA a USSR 3TNK 105mm shell crosses the connected BRIK wall cell at
 * (38,43) on tick 870. C++ keeps connected brick wall overlays at the
 * next-to-last damage level when the Wall_Update connection low nibble is
 * non-zero, so BulletClass::Is_Forced_To_Explode detonates the low projectile
 * against the high wall. TS used to clear the wall as soon as damage reached
 * that visual level, letting the shell keep flying and skipping the wall damage
 * RNG call.
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

async function wasmShellState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const shell = (state.bullets ?? []).find((bullet: any) =>
      bullet.type === 'Cannon' &&
      bullet.str === 30 &&
      bullet.wh === 2 &&
      bullet.tx === 9536 &&
      bullet.ty === 11712);
    return {
      tick: state.tick,
      rngState: state.rngState,
      shell: shell
        ? {
            type: shell.type,
            strength: shell.str,
            warhead: shell.wh,
            lx: shell.lx,
            ly: shell.ly,
            tx: shell.tx,
            ty: shell.ty,
            timer: shell.timer,
          }
        : null,
    };
  });
}

async function tsShellAndWallState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const shell = (game.inflightProjectiles ?? []).find((projectile: any) =>
      projectile.weapon?.name === '105mm' &&
      projectile.damage === 30 &&
      projectile.headToLX === 9536 &&
      projectile.headToLY === 11712);
    const wallCell = { cx: 38, cy: 43 };
    const wallIdx = wallCell.cy * 128 + wallCell.cx;
    return {
      tick: state.tick,
      rngState: state.rngState,
      wall: {
        type: game.map.getWallType(wallCell.cx, wallCell.cy),
        damageLevel: game.map.getWallDamageLevel(wallCell.cx, wallCell.cy),
        terrain: game.map.getTerrain(wallCell.cx, wallCell.cy),
        overlay: game.map.overlay[wallIdx],
      },
      shell: shell
        ? {
            weapon: shell.weapon?.name,
            damage: shell.damage,
            currentFrame: shell.currentFrame,
            fuseTimer: shell.fuseTimer,
            logicalLX: shell.logicalLX,
            logicalLY: shell.logicalLY,
            headToLX: shell.headToLX,
            headToLY: shell.headToLY,
          }
        : null,
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU12 BRIK wall shell collision', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps connected damaged BRIK walls solid for low shells', async () => {
    await withDualScenario('SCU12EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      await stepBothInCppSizedChunks(handle, 869);

      const cppBefore = await wasmShellState(handle.wasm);
      const tsBefore = await tsShellAndWallState(handle.ts);
      expect(cppBefore.tick).toBe(869);
      expect(tsBefore.tick).toBe(cppBefore.tick);
      expect(cppBefore.shell).not.toBeNull();
      expect(tsBefore.shell).not.toBeNull();
      expect(tsBefore.wall).toMatchObject({
        type: 'BRIK',
        damageLevel: 2,
        terrain: 4,
        overlay: 2,
      });

      await stepBoth(handle, 1);

      const cppAfter = await wasmShellState(handle.wasm);
      const tsAfter = await tsShellAndWallState(handle.ts);
      expect(cppAfter.tick).toBe(870);
      expect(tsAfter.tick).toBe(cppAfter.tick);
      expect(cppAfter.shell).toBeNull();
      expect(tsAfter.shell).toBeNull();
      expect(tsAfter.rngState).toBe(cppAfter.rngState);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 300_000);
});
