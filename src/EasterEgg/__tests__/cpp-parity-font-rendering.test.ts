import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractAllMIX } from '../../../scripts/ra-assets/gamedata.js';
import { parseFnt } from '../../../scripts/ra-assets/fnt.js';
import { MixFile } from '../../../scripts/ra-assets/mix.js';
import { BitmapFont, type BitmapFontMeta } from '../engine/bitmapFont';

const projectRoot = resolve(__dirname, '../../..');
const gamedataPath = resolve(projectRoot, 'public/ra/gamedata.data');
const gamedataJsPath = resolve(projectRoot, 'public/ra/gamedata.js');
const assetsDir = resolve(projectRoot, 'public/ra/assets');

describe('C++ bitmap font metrics (font.cpp / drawbuff.cpp)', () => {
  function readPackedFont(name: string): Buffer {
    const mixes = extractAllMIX(gamedataPath, gamedataJsPath);
    for (const mixName of ['CONQUER.MIX', 'GENERAL.MIX', 'LOCAL.MIX', 'HIRES.MIX', 'TEMPERAT.MIX']) {
      const mixData = mixes.get(mixName);
      if (!mixData) continue;
      const fontData = MixFile.fromBuffer(mixData).readFile(name);
      if (fontData) return fontData;
    }
    throw new Error(`${name} not found in packaged C++ MIX data`);
  }

  it('keeps the blank space glyph width from the FNT width table', () => {
    // C++ Char_Pixel_Width reads FontWidthBlockPtr[chr] even when the glyph has
    // no bitmap rows. Dropping char 32 makes String_Pixel_Width too wide.
    const expected: Record<string, { width: number; height: number; topBlank: number }> = {
      '6POINT.FNT': { width: 7, height: 0, topBlank: 10 },
      'GRAD6FNT.FNT': { width: 7, height: 0, topBlank: 16 },
      '8POINT.FNT': { width: 6, height: 0, topBlank: 11 },
      '12METFNT.FNT': { width: 7, height: 0, topBlank: 16 },
    };

    for (const [name, metrics] of Object.entries(expected)) {
      const font = parseFnt(readPackedFont(name));
      expect(font.glyphs.get(32), `${name} space metrics`).toMatchObject(metrics);
    }
  });

  it('matches C++ String_Pixel_Width for GRAD6FNT mission messages', () => {
    const meta = JSON.parse(readFileSync(resolve(assetsDir, 'grad6-font.json'), 'utf-8')) as BitmapFontMeta;
    const font = new BitmapFont({} as HTMLImageElement, meta);

    // dialog.cpp sets FontXSpacing to -1 for RESFACTOR=2 +
    // TPF_6PT_GRAD + TPF_FULLSHADOW.
    expect(font.measureText('Keep the Chronosphere on-line', -1)).toBe(188);
  });

  it('advances blank glyphs without blitting another source cell', () => {
    const atlas = {} as HTMLImageElement;
    const meta: BitmapFontMeta = {
      maxWidth: 10,
      maxHeight: 10,
      atlasWidth: 20,
      atlasHeight: 10,
      cellWidth: 10,
      cellHeight: 10,
      glyphs: {
        32: { ax: 0, ay: 0, w: 7, h: 0, topBlank: 10 },
        65: { ax: 10, ay: 0, w: 9, h: 9, topBlank: 0 },
      },
    };
    const font = new BitmapFont(atlas, meta);
    const tintCtx = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      globalCompositeOperation: 'source-over',
      fillStyle: '#fff',
    };
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => tintCtx,
      }),
    });

    const drawImage = vi.fn();
    const ctx = {
      imageSmoothingEnabled: true,
      drawImage,
    } as unknown as CanvasRenderingContext2D;

    font.drawText(ctx, 'A A', 0, 0, '#ffffff');

    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(drawImage.mock.calls[0][5]).toBe(0);
    expect(drawImage.mock.calls[1][5]).toBe(16);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
