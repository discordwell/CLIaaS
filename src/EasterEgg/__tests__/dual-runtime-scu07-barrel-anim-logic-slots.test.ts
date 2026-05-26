/**
 * SCU07EA visual parity regression: static scenario buildings must reserve
 * their C++ Logic slots so runtime barrel-fire AnimClass objects allocate after
 * the building block and draw in the same layer order.
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

type AnimSignature = {
  logicIndex: number;
  name: string;
  lx: number;
  ly: number;
  stage: number;
  loops: number;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmBarrelClusterSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const structureRow = (state.logicLayer ?? []).find((row: any[]) => row[0] === 184);

    return {
      tick: state.tick,
      rngState: state.rngState,
      structureSlot: structureRow
        ? {
            logicIndex: structureRow[0],
            type: structureRow[1],
            house: structureRow[2],
            cx: structureRow[3],
            cy: structureRow[4],
            rtti: structureRow[5],
          }
        : null,
      anims: (state.anims ?? [])
        .filter((anim: any) => anim.logicIndex >= 185 && anim.logicIndex <= 205)
        .map((anim: any) => ({
          logicIndex: anim.logicIndex,
          name: anim.name,
          lx: anim.lx,
          ly: anim.ly,
          stage: anim.stage,
          loops: anim.loops,
        }))
        .sort((a: AnimSignature, b: AnimSignature) => a.logicIndex - b.logicIndex),
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    structureSlot: { logicIndex: number; type: string; house: string; cx: number; cy: number; rtti: string } | null;
    anims: AnimSignature[];
  }>;
}

async function tsBarrelClusterSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const state = (window as any).__agentState();
    const cppNameForType = (type: string): string => {
      switch (type) {
        case 'fire_small':
          return 'FIRE3';
        case 'fire_med':
          return 'FIRE2';
        case 'smoke_m':
          return 'SMOKE_M';
        default:
          return type.toUpperCase();
      }
    };
    const structure = (game.structures ?? []).find((s: any) => s.logicIndexHint === 184);

    return {
      tick: game.tick,
      rngState: state.rngState,
      structureSlot: structure
        ? {
            logicIndex: structure.logicIndexHint,
            type: structure.type,
            house: structure.house,
            cx: structure.cx,
            cy: structure.cy,
            rtti: 'B',
          }
        : null,
      anims: (game.logicAnims ?? [])
        .filter((anim: any) => anim.logicIndexHint >= 185 && anim.logicIndexHint <= 205)
        .map((anim: any) => ({
          logicIndex: anim.logicIndexHint,
          name: cppNameForType(anim.type),
          lx: Math.round(anim.x * 256 / 24),
          ly: Math.round(anim.y * 256 / 24),
          stage: anim.stage,
          loops: anim.loops,
        }))
        .sort((a: AnimSignature, b: AnimSignature) => a.logicIndex - b.logicIndex),
    };
  }) as Promise<{
    tick: number;
    rngState: number;
    structureSlot: { logicIndex: number; type: string; house: string; cx: number; cy: number; rtti: string } | null;
    anims: AnimSignature[];
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU07 scenario building Logic slots', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('keeps scenario building slots ahead of barrel-fire AnimClass allocations', async () => {
    await withDualScenario('SCU07EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      const cpp = await wasmBarrelClusterSnapshot(handle.wasm);
      const ts = await tsBarrelClusterSnapshot(handle.ts);

      expect(ts.tick).toBe(cpp.tick);
      expect(ts.rngState >>> 0).toBe(cpp.rngState >>> 0);
      expect(ts.structureSlot).toEqual(cpp.structureSlot);
      expect(ts.anims).toEqual(cpp.anims);
    }, { wasmSeed: 0 });
  }, 300_000);
});
