/**
 * Dual-runtime visual regression for airborne infantry SHAPE_GHOST handling.
 *
 * In C++ TechnoClass::Techno_Draw_Object switches to Map.UnitShadowAir when
 * Height > 0. display.cpp then replaces UnitShadowAir's translucent row with
 * PCOLOR_GOLD's identity remap table, so the LTGREEN shadow-control pixels in
 * paradropped infantry do not darken the destination while the unit is falling.
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

function adapterPage(adapter: unknown): EvalPage {
  const page = (adapter as { page?: EvalPage }).page;
  if (!page) throw new Error('Adapter page is not available');
  return page;
}

async function wasmPixel(adapter: unknown, x: number, y: number): Promise<number[]> {
  return adapterPage(adapter).evaluate(({ x, y }) => {
    const module = (window as any).Module;
    module.ccall('agent_render', null, [], []);
    const ptr = (window as any).__agentFramePtr;
    if (!ptr || !module.HEAPU8) throw new Error('agent render frame buffer is unavailable');
    const offset = (y * 640 + x) * 4;
    return [
      module.HEAPU8[ptr + offset],
      module.HEAPU8[ptr + offset + 1],
      module.HEAPU8[ptr + offset + 2],
      module.HEAPU8[ptr + offset + 3],
    ];
  }, { x, y });
}

async function tsPixel(adapter: unknown, x: number, y: number): Promise<number[]> {
  return adapterPage(adapter).evaluate(({ x, y }) => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('TS canvas is unavailable');
    const data = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  }, { x, y });
}

async function tsDogProbe(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const dog = game.entities.find((e: any) => e.type === 'DOG' && e.cell?.cx === 21 && e.cell?.cy === 83);
    if (!dog) throw new Error('SCU35EA paradropped DOG at (21,83) not found');
    const screen = game.camera.worldToScreen(dog.pos.x, dog.pos.y);
    return {
      type: dog.type,
      house: dog.house,
      spriteFrame: dog.spriteFrame,
      bodyFacing32: dog.bodyFacing32,
      fallHeightLeptons: dog.fallHeightLeptons,
      flightAltitude: dog.flightAltitude,
      screenX: Math.round(screen.x),
      screenY: Math.round(screen.y),
    };
  });
}

async function tsGeneralProbe(adapter: unknown) {
  return adapterPage(adapter).evaluate(() => {
    const game = (window as any).__agentGame;
    const general = game.entities.find((e: any) => e.type === 'GNRL' && e.cell?.cx === 21 && e.cell?.cy === 82);
    if (!general) throw new Error('SCU35EA paradropped GNRL at (21,82) not found');
    const screen = game.camera.worldToScreen(general.pos.x, general.pos.y);
    return {
      type: general.type,
      house: general.house,
      spriteFrame: general.spriteFrame,
      bodyFacing32: general.bodyFacing32,
      fallHeightLeptons: general.fallHeightLeptons,
      flightAltitude: general.flightAltitude,
      screenX: Math.round(screen.x),
      screenY: Math.round(screen.y),
    };
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU35 paradrop airborne shadow rendering', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('leaves airborne DOG shadow-control pixels as UnitShadowAir pass-through', async () => {
    await withDualScenario('SCU35EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      await expect(tsDogProbe(handle.ts)).resolves.toEqual({
        type: 'DOG',
        house: 'USSR',
        spriteFrame: 4,
        bodyFacing32: 16,
        fallHeightLeptons: 160,
        flightAltitude: 15,
        screenX: 78,
        screenY: 250,
      });

      await expect(tsGeneralProbe(handle.ts)).resolves.toEqual({
        type: 'GNRL',
        house: 'USSR',
        spriteFrame: 4,
        bodyFacing32: 16,
        fallHeightLeptons: 172,
        flightAltitude: 16,
        screenX: 78,
        screenY: 238,
      });

      const [cpp, ts, generalCpp, generalTs] = await Promise.all([
        wasmPixel(handle.wasm, 78, 238),
        tsPixel(handle.ts, 78, 238),
        wasmPixel(handle.wasm, 74, 215),
        tsPixel(handle.ts, 74, 215),
      ]);

      expect(ts).toEqual(cpp);
      expect(generalTs).toEqual(generalCpp);
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 180_000);
});
