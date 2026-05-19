/**
 * Dual-runtime check for BuildingClass::Take_Damage player return-fire side effects.
 *
 * In SCU31EA tick 179, a Greece Dragon projectile damages a player-owned USSR
 * flame turret at (66,91). C++ refuses to auto-retarget because
 * PlayerReturnFire=no, but still calls Random_Pick(DIR_N, DIR_MAX) to pick a
 * random PrimaryFacing reaction. TS must burn that same RNG instead of only
 * applying HP damage.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ensureParityServer,
  isDevServerAvailable,
  stepBoth,
  stopParityServer,
  withDualScenario,
  type DualRuntimeHandle,
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

async function stepBothInChunks(handle: DualRuntimeHandle, ticks: number): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 250);
    await stepBoth(handle, chunk);
    remaining -= chunk;
  }
}

async function tsFturState(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const s = game.structures.find((structure: any) =>
      structure.type === 'FTUR' &&
      structure.house === 'USSR' &&
      structure.cx === 66 &&
      structure.cy === 91);
    return s
      ? {
          hp: s.hp,
          targetEntityId: s.targetEntityId,
          turretFacing256: s.turretFacing256,
          desiredTurretFacing256: s.desiredTurretFacing256,
        }
      : null;
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU31 building damage facing RNG', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('burns the player-building random facing call on tick 179', async () => {
    await withDualScenario('SCU31EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await adapterPage(handle.ts).evaluate(() => {
        (window as any).__rngTagControl?.('enable');
      });

      await stepBothInChunks(handle, 178);
      await adapterPage(handle.ts).evaluate(() => {
        (window as any).__rngTagControl?.('reset');
      });

      const step = await stepBoth(handle, 1);
      const tsRng = await adapterPage(handle.ts).evaluate(() =>
        (window as any).__rngTagControl?.('read') ?? { seed: 0, seedLog: [] });
      const ftur = await tsFturState(handle.ts);

      expect(step.wasm.state.tick).toBe(179);
      expect(step.ts.state.tick).toBe(179);
      expect(step.wasm.state.rngLog).toContainEqual([2947920882, 52005, 15157]);
      expect(tsRng.seedLog.some(([seed, tag]: [number, number]) =>
        (seed >>> 0) === 2947920882 && tag === 52005)).toBe(true);
      expect(tsRng.seed >>> 0).toBe(step.wasm.state.rngState! >>> 0);
      expect(ftur).toMatchObject({
        hp: 365,
        targetEntityId: undefined,
      });
    }, { preserveSourceFog: true });
  }, 180_000);
});
