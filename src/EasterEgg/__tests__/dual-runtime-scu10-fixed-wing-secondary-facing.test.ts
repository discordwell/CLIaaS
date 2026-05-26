/**
 * Dual-runtime check for AircraftClass::Rotation_AI fixed-wing secondary facing.
 *
 * C++ copies SecondaryFacing from PrimaryFacing for fixed-wing aircraft, then
 * still applies SecondaryFacing.Rotation_Adjust(Class->ROT) in the same
 * Rotation_AI pass. SCU10EA tick 50 has two YAKs where PrimaryFacing is still
 * rotating; skipping the secondary rotation leaves their drawn frame one step
 * behind C++ and creates a visible aircraft residual.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

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

interface FixedWingFacingSnapshot {
  logicIndex: number;
  type: string;
  primaryFacing: number;
  desiredPrimaryFacing: number;
  secondaryFacing: number;
  desiredSecondaryFacing: number;
}

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
      const si = ((box.y + y) * source.width + box.x + x) * 4;
      const di = (y * box.w + x) * 4;
      out.data[di] = source.data[si];
      out.data[di + 1] = source.data[si + 1];
      out.data[di + 2] = source.data[si + 2];
      out.data[di + 3] = source.data[si + 3];
    }
  }
  return out;
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

function expectCropMatch(wasmPng: PNG, tsPng: PNG, box: { x: number; y: number; w: number; h: number }): void {
  const wasmCrop = cropPng(wasmPng, box);
  const tsCrop = cropPng(tsPng, box);
  const diff = new PNG({ width: box.w, height: box.h });
  const mismatch = pixelmatch(wasmCrop.data, tsCrop.data, diff.data, box.w, box.h, {
    threshold: 0.1,
    includeAA: true,
  });
  expect(mismatch).toBe(0);
}

function expectCropExactMatch(wasmPng: PNG, tsPng: PNG, box: { x: number; y: number; w: number; h: number }): void {
  const wasmCrop = cropPng(wasmPng, box);
  const tsCrop = cropPng(tsPng, box);
  let mismatches = 0;
  for (let i = 0; i < wasmCrop.data.length; i += 4) {
    if (
      wasmCrop.data[i] !== tsCrop.data[i]
      || wasmCrop.data[i + 1] !== tsCrop.data[i + 1]
      || wasmCrop.data[i + 2] !== tsCrop.data[i + 2]
      || wasmCrop.data[i + 3] !== tsCrop.data[i + 3]
    ) {
      mismatches++;
    }
  }
  expect(mismatches).toBe(0);
}

async function wasmFixedWingFacing(adapter: unknown): Promise<FixedWingFacingSnapshot[]> {
  return adapterPage(adapter).evaluate(() => {
    const state = JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], []));
    const logicIndexById = new Map<number, number>(
      (state.logicLayer ?? [])
        .filter((row: any[]) => row[1] === 'YAK' || row[1] === 'MIG')
        .map((row: any[]) => [row[6], row[0]]),
    );
    return (state.units ?? [])
      .filter((entry: any) => entry.t === 'YAK' || entry.t === 'MIG')
      .map((entry: any) => ({
        logicIndex: logicIndexById.get(entry.id) ?? -1,
        type: entry.t,
        primaryFacing: entry.pf,
        desiredPrimaryFacing: entry.pfd,
        secondaryFacing: entry.sf,
        desiredSecondaryFacing: entry.sfd,
      }))
      .sort((a: FixedWingFacingSnapshot, b: FixedWingFacingSnapshot) => a.logicIndex - b.logicIndex);
  });
}

async function tsFixedWingFacing(adapter: unknown): Promise<FixedWingFacingSnapshot[]> {
  return adapterPage(adapter).evaluate(() => {
    return ((window as any).__agentAircraft?.() ?? [])
      .filter((entry: any) => entry.type === 'YAK' || entry.type === 'MIG')
      .map((entry: any) => ({
        logicIndex: entry.logicIndexHint ?? -1,
        type: entry.type,
        primaryFacing: entry.facing256,
        desiredPrimaryFacing: entry.desiredFacing256,
        secondaryFacing: entry.turretFacing256,
        desiredSecondaryFacing: entry.desiredTurretFacing256,
      }))
      .sort((a: FixedWingFacingSnapshot, b: FixedWingFacingSnapshot) => a.logicIndex - b.logicIndex);
  });
}

describe.skipIf(!serverUp)('Dual runtime C++ parity: SCU10 fixed-wing secondary facing', () => {
  beforeAll(async () => {
    serverHandle = await ensureParityServer();
  }, 180_000);

  afterAll(async () => {
    await stopParityServer(serverHandle);
  }, 20_000);

  it('rotates fixed-wing SecondaryFacing after copying PrimaryFacing', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      const result = await stepBoth(handle, 50);

      const cpp = await wasmFixedWingFacing(handle.wasm);
      expect(cpp).toEqual([
        {
          logicIndex: 285,
          type: 'YAK',
          primaryFacing: 146,
          desiredPrimaryFacing: 193,
          secondaryFacing: 151,
          desiredSecondaryFacing: 193,
        },
        {
          logicIndex: 286,
          type: 'YAK',
          primaryFacing: 153,
          desiredPrimaryFacing: 192,
          secondaryFacing: 158,
          desiredSecondaryFacing: 192,
        },
        {
          logicIndex: 287,
          type: 'YAK',
          primaryFacing: 116,
          desiredPrimaryFacing: 116,
          secondaryFacing: 116,
          desiredSecondaryFacing: 116,
        },
        {
          logicIndex: 288,
          type: 'MIG',
          primaryFacing: 136,
          desiredPrimaryFacing: 136,
          secondaryFacing: 136,
          desiredSecondaryFacing: 136,
        },
        {
          logicIndex: 289,
          type: 'MIG',
          primaryFacing: 149,
          desiredPrimaryFacing: 149,
          secondaryFacing: 149,
          desiredSecondaryFacing: 149,
        },
      ]);

      expect(await tsFixedWingFacing(handle.ts)).toEqual(cpp);
      expect(result.ts.state.rngState >>> 0).toBe(result.wasm.state.rngState! >>> 0);
    }, { wasmSeed: 0 });
  }, 240_000);

  it('draws hack-prevented aircraft cameos through the C++ sidebar clock palette path', async () => {
    await withDualScenario('SCU10EA', async (handle) => {
      await handle.ts.syncRngSeed(handle.wasmState.rngState!);
      await stepBoth(handle, 100);

      const [wasmPng, tsPng] = await Promise.all([
        wasmRenderedFrame(handle.wasm),
        tsRenderedFrame(handle.ts),
      ]);
      expectCropExactMatch(wasmPng, tsPng, { x: 570, y: 180, w: 64, h: 144 });
    }, { wasmSeed: 0, preserveSourceFog: true });
  }, 240_000);
});
