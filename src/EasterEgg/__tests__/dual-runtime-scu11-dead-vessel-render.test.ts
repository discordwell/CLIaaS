/**
 * Dual-runtime visual check for zero-strength VesselClass objects that remain
 * in C++ LAYER_GROUND.
 *
 * SCU11EA tick 50 has Greece DD logic 91 at Strength=0, but the C++ layer dump
 * still reports the object down/displayable and the rendered frame still shows
 * the hull. Treating TS `alive=false` as a render-removal skips that hull and
 * creates the largest SCU11 visual residual.
 */
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
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

function dataUrlToPng(dataUrl: string): PNG {
  return PNG.sync.read(Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
}

function cropPng(source: PNG, box: { x: number; y: number; w: number; h: number }): PNG {
  const out = new PNG({ width: box.w, height: box.h });
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const si = ((box.y + y) * source.width + (box.x + x)) * 4;
      const di = (y * box.w + x) * 4;
      out.data[di] = source.data[si];
      out.data[di + 1] = source.data[si + 1];
      out.data[di + 2] = source.data[si + 2];
      out.data[di + 3] = source.data[si + 3];
    }
  }
  return out;
}

async function wasmDeadDestroyerSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === 91);
    const layer = JSON.parse(module.ccall(
      'agent_dump_layer',
      'string',
      ['number', 'number', 'number', 'number', 'number'],
      [1, 0, 0, 127, 127],
    ));
    const object = (layer.objects ?? []).find((entry: any) => entry.logicIndex === 91);
    return {
      tick: state.tick,
      row: row ? {
        logicIndex: row[0],
        type: row[1],
        house: row[2],
        cx: row[3],
        cy: row[4],
        hp: row[14],
      } : null,
      object: object ? {
        logicIndex: object.logicIndex,
        type: object.name,
        display: object.display,
        down: object.down,
        limbo: object.limbo,
      } : null,
    };
  }) as Promise<{
    tick: number;
    row: { logicIndex: number; type: string; house: string; cx: number; cy: number; hp: number } | null;
    object: { logicIndex: number; type: string; display: boolean; down: boolean; limbo: boolean } | null;
  }>;
}

async function tsDeadDestroyerSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const entity = (game.entities ?? []).find((entry: any) => entry.logicIndexHint === 91);
    return entity ? {
      type: entity.type,
      house: entity.house,
      alive: entity.alive,
      hp: entity.hp,
      occupiesCppLogic: entity.occupiesCppLogic(),
      inLimbo: entity.inLimbo,
    } : null;
  }) as Promise<{
    type: string;
    house: string;
    alive: boolean;
    hp: number;
    occupiesCppLogic: boolean;
    inLimbo: boolean;
  } | null>;
}

async function wasmSubmarineCloakSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    const state = JSON.parse(module.ccall('agent_get_state', 'string', [], []));
    const row = (state.logicLayer ?? []).find((entry: any[]) => entry[0] === 88);
    const layer = JSON.parse(module.ccall(
      'agent_dump_layer',
      'string',
      ['number', 'number', 'number', 'number', 'number'],
      [1, 0, 0, 127, 127],
    ));
    const object = (layer.objects ?? []).find((entry: any) => entry.logicIndex === 88);
    return {
      tick: state.tick,
      row: row ? {
        logicIndex: row[0],
        type: row[1],
        house: row[2],
        cx: row[3],
        cy: row[4],
        hp: row[14],
        cloak: row[16],
        cloakStage: row[17],
      } : null,
      object: object ? {
        logicIndex: object.logicIndex,
        type: object.name,
        display: object.display,
        down: object.down,
        limbo: object.limbo,
      } : null,
    };
  }) as Promise<{
    tick: number;
    row: {
      logicIndex: number;
      type: string;
      house: string;
      cx: number;
      cy: number;
      hp: number;
      cloak: number;
      cloakStage: number;
    } | null;
    object: { logicIndex: number; type: string; display: boolean; down: boolean; limbo: boolean } | null;
  }>;
}

async function tsSubmarineCloakSnapshot(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const entity = (game.entities ?? []).find((entry: any) => entry.logicIndexHint === 88);
    return entity ? {
      type: entity.type,
      house: entity.house,
      alive: entity.alive,
      hp: entity.hp,
      cloakState: entity.cloakState,
      cloakTimer: entity.cloakTimer,
      sonarPulseTimer: entity.sonarPulseTimer,
    } : null;
  }) as Promise<{
    type: string;
    house: string;
    alive: boolean;
    hp: number;
    cloakState: number;
    cloakTimer: number;
    sonarPulseTimer: number;
  } | null>;
}

async function wasmRenderedFrame(adapter: unknown): Promise<PNG> {
  const dataUrl = await adapterPage(adapter).evaluate(() => {
    const module = (window as any).Module;
    module.ccall('agent_render', null, [], []);
    const ptr = (window as any).__agentFramePtr;
    if (!ptr || !module.HEAPU8) throw new Error('agent render frame buffer is unavailable');
    const w = 640;
    const h = 400;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(w, h);
    const heap = module.HEAPU8;
    for (let i = 0; i < w * h * 4; i++) image.data[i] = heap[ptr + i];
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  });
  return dataUrlToPng(dataUrl);
}

async function tsRenderedFrame(adapter: unknown): Promise<PNG> {
  const dataUrl = await adapterPage(adapter).evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('TS canvas is unavailable');
    return canvas.toDataURL('image/png');
  });
  return dataUrlToPng(dataUrl);
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU11 dead vessel rendering', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('renders the zero-strength DD that C++ still has down in LAYER_GROUND', async () => {
    await withDualScenario('SCU11EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 50);

      const cpp = await wasmDeadDestroyerSnapshot(handle.wasm);
      const ts = await tsDeadDestroyerSnapshot(handle.ts);

      expect(cpp.row).toEqual({
        logicIndex: 91,
        type: 'DD',
        house: 'Greece',
        cx: 67,
        cy: 97,
        hp: 0,
      });
      expect(cpp.object).toEqual({
        logicIndex: 91,
        type: 'DD',
        display: true,
        down: true,
        limbo: false,
      });
      expect(ts).toEqual({
        type: 'DD',
        house: 'Greece',
        alive: false,
        hp: 0,
        occupiesCppLogic: true,
        inLimbo: false,
      });

      const wasmPng = await wasmRenderedFrame(handle.wasm);
      const tsPng = await tsRenderedFrame(handle.ts);
      const box = { x: 200, y: 132, w: 90, h: 30 };
      const wasmCrop = cropPng(wasmPng, box);
      const tsCrop = cropPng(tsPng, box);
      const diff = new PNG({ width: box.w, height: box.h });
      const mismatch = pixelmatch(wasmCrop.data, tsCrop.data, diff.data, box.w, box.h, {
        threshold: 0.1,
        includeAA: true,
      });

      expect(mismatch).toBe(0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);

  it('renders uncloaking submarines through the C++ vessel cloak visual path', async () => {
    await withDualScenario('SCU11EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 50);

      const cpp = await wasmSubmarineCloakSnapshot(handle.wasm);
      const ts = await tsSubmarineCloakSnapshot(handle.ts);

      expect(cpp.row).toEqual({
        logicIndex: 88,
        type: 'SS',
        house: 'USSR',
        cx: 62,
        cy: 102,
        hp: 100,
        cloak: 3,
        cloakStage: 13,
      });
      expect(cpp.object).toEqual({
        logicIndex: 88,
        type: 'SS',
        display: true,
        down: true,
        limbo: false,
      });
      expect(ts).toEqual({
        type: 'SS',
        house: 'USSR',
        alive: true,
        hp: 100,
        cloakState: 3,
        cloakTimer: 25,
        sonarPulseTimer: 0,
      });

      const wasmPng = await wasmRenderedFrame(handle.wasm);
      const tsPng = await tsRenderedFrame(handle.ts);
      const box = { x: 100, y: 240, w: 48, h: 60 };
      const wasmCrop = cropPng(wasmPng, box);
      const tsCrop = cropPng(tsPng, box);
      const diff = new PNG({ width: box.w, height: box.h });
      const mismatch = pixelmatch(wasmCrop.data, tsCrop.data, diff.data, box.w, box.h, {
        threshold: 0.1,
        includeAA: true,
      });

      expect(mismatch).toBe(0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);

  it('renders cloaking submarines through the C++ remap-only vessel fading path', async () => {
    await withDualScenario('SCU11EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      const cpp = await wasmSubmarineCloakSnapshot(handle.wasm);
      const ts = await tsSubmarineCloakSnapshot(handle.ts);

      expect(cpp.row).toEqual({
        logicIndex: 88,
        type: 'SS',
        house: 'USSR',
        cx: 62,
        cy: 102,
        hp: 100,
        cloak: 1,
        cloakStage: 7,
      });
      expect(cpp.object).toEqual({
        logicIndex: 88,
        type: 'SS',
        display: true,
        down: true,
        limbo: false,
      });
      expect(ts).toEqual({
        type: 'SS',
        house: 'USSR',
        alive: true,
        hp: 100,
        cloakState: 1,
        cloakTimer: 31,
        sonarPulseTimer: 0,
      });

      const wasmPng = await wasmRenderedFrame(handle.wasm);
      const tsPng = await tsRenderedFrame(handle.ts);
      const box = { x: 104, y: 250, w: 40, h: 42 };
      const wasmCrop = cropPng(wasmPng, box);
      const tsCrop = cropPng(tsPng, box);
      const diff = new PNG({ width: box.w, height: box.h });
      const mismatch = pixelmatch(wasmCrop.data, tsCrop.data, diff.data, box.w, box.h, {
        threshold: 0.1,
        includeAA: true,
      });

      expect(mismatch).toBe(0);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
