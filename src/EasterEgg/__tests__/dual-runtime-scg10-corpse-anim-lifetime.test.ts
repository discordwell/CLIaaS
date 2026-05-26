/**
 * Dual-runtime check for corpse AnimClass lifetime.
 *
 * SCG10EB creates three CORPSE1 ground-layer AnimClass objects in the north
 * base fight. C++ deletes the first at tick 80 and the second at tick 95; TS
 * must stop rendering and counting those corpse slots on the same ticks.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CPP_CORPSE_FRAME_COUNT, CPP_CORPSE_FRAME_TICKS } from '../engine/types.js';
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

async function stepBothTo(handle: Parameters<typeof stepBoth>[0], targetTick: number, currentTick: number): Promise<void> {
  let remaining = targetTick - currentTick;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 15);
    await stepBoth(handle, chunk);
    remaining -= chunk;
  }
}

async function wasmCorpseLayer(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const layer = JSON.parse(module.ccall(
      'agent_dump_layer',
      'string',
      ['number', 'number', 'number', 'number', 'number'],
      [0, 60, 68, 72, 75],
    ));
    const corpses = ((layer.objects ?? []) as any[])
      .filter(object => String(object.name).startsWith('CORPSE'))
      .map(object => ({
        name: object.name,
        logicIndex: object.logicIndex,
        cx: object.cx,
        cy: object.cy,
        x: Math.round(object.lx * 24 / 256),
        y: Math.round(object.ly * 24 / 256),
      }));
    return { tick: state.tick, corpses };
  }) as Promise<{
    tick: number;
    corpses: Array<{ name: string; logicIndex: number; cx: number; cy: number; x: number; y: number }>;
  }>;
}

async function tsRenderedCorpses(adapter: unknown) {
  return adapterPage(adapter).evaluate(({ frameCount, frameTicks }) => {
    const game = (window as any).__agentGame;
    const corpses = ((game?.corpses ?? []) as any[])
      .map(corpse => {
        const elapsed = Math.max(0, game.tick - (corpse.cppAnimStartTick ?? game.tick));
        return {
          type: corpse.type,
          deathVariant: corpse.deathVariant,
          logicIndex: corpse.logicIndexHint ?? null,
          cx: Math.floor((corpse.x ?? 0) / 24),
          cy: Math.floor((corpse.y ?? 0) / 24),
          x: Math.round(corpse.x ?? 0),
          y: Math.round(corpse.y ?? 0),
          frame: Math.floor(elapsed / frameTicks),
        };
      })
      .filter(corpse =>
        corpse.cx >= 60 && corpse.cx <= 72 &&
        corpse.cy >= 68 && corpse.cy <= 75 &&
        corpse.deathVariant >= 1 &&
        corpse.deathVariant <= 3 &&
        corpse.frame < frameCount);
    return { tick: game.tick, corpses };
  }, {
    frameCount: CPP_CORPSE_FRAME_COUNT,
    frameTicks: CPP_CORPSE_FRAME_TICKS,
  }) as Promise<{
    tick: number;
    corpses: Array<{ type: string; deathVariant: number; logicIndex: number | null; cx: number; cy: number; x: number; y: number; frame: number }>;
  }>;
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG10EB corpse AnimClass lifetime', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('stops rendering corpse anims on the same ticks C++ removes them from layer 0', async () => {
    await withDualScenario('SCG10EB', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);

      let currentTick = 0;
      for (const targetTick of [79, 80, 95, 99]) {
        await stepBothTo(handle, targetTick, currentTick);
        currentTick = targetTick;

        const cpp = await wasmCorpseLayer(handle.wasm);
        const ts = await tsRenderedCorpses(handle.ts);
        expect(ts.tick).toBe(cpp.tick);
        expect(ts.corpses).toHaveLength(cpp.corpses.length);
        for (let i = 0; i < cpp.corpses.length; i++) {
          expect(ts.corpses[i]).toMatchObject({
            cx: cpp.corpses[i].cx,
            cy: cpp.corpses[i].cy,
          });
          expect(Math.abs(ts.corpses[i].x - cpp.corpses[i].x)).toBeLessThanOrEqual(1);
          expect(Math.abs(ts.corpses[i].y - cpp.corpses[i].y)).toBeLessThanOrEqual(1);
        }
      }
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 120_000);
});
