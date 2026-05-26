/**
 * Dual-runtime visual regression for AnimTypeClass::IsGroundLayer.
 *
 * SCG20EA destroys a tank near the starting camera by tick 100. C++ submits the
 * paired impact animations to different draw layers: VEH-HIT2 stays in the
 * upper layer, while FRAG1 has IsGroundLayer=true and sorts with ground objects.
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
  evaluate<T, A = unknown>(fn: (arg: A) => T, arg?: A): Promise<T>;
};

type LayerObject = {
  name: string;
  stage: number;
  cx: number;
  cy: number;
  logicIndex: number;
};

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmLayerObjects(adapter: unknown, layer: number): Promise<LayerObject[]> {
  return adapterPage(adapter).evaluate((targetLayer) => {
    const raw = (window as any).Module.ccall(
      'agent_dump_layer',
      'string',
      ['number', 'number', 'number', 'number', 'number'],
      [targetLayer, 27, 58, 27, 58],
    );
    return JSON.parse(raw).objects;
  }, layer);
}

async function tsGroundImpactAnims(adapter: unknown): Promise<Array<{
  type: string;
  stage: number;
  x: number;
  y: number;
  logicIndexHint: number | undefined;
}>> {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const entries = game.renderer.collectGroundLayerEntries(game.entities, game.structures);
    return entries
      .filter((entry: any) => entry.kind === 'anim' && entry.anim.x === 660 && entry.anim.y === 1404)
      .map((entry: any) => ({
        type: entry.anim.type,
        stage: entry.anim.stage,
        x: entry.anim.x,
        y: entry.anim.y,
        logicIndexHint: entry.anim.logicIndexHint,
      }));
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCG20 FRAG1 ground layer', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('sorts FRAG1 with C++ ground-layer objects while VEH-HIT2 remains upper-layer', async () => {
    await withDualScenario('SCG20EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      const [cppGround, cppUpper, tsGround] = await Promise.all([
        wasmLayerObjects(handle.wasm, 1),
        wasmLayerObjects(handle.wasm, 2),
        tsGroundImpactAnims(handle.ts),
      ]);

      expect(cppGround).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'FRAG1', stage: 11, cx: 27, cy: 58 }),
      ]));
      expect(cppUpper).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'VEH-HIT2', stage: 11, cx: 27, cy: 58 }),
      ]));
      expect(tsGround).toEqual([
        expect.objectContaining({ type: 'frag1', stage: 11, x: 660, y: 1404 }),
      ]);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 180_000);
});
