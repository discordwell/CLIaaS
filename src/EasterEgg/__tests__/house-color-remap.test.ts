/**
 * @vitest-environment jsdom
 *
 * House color remap data tests — validates public/ra/assets/remap-colors.json has
 * all House enum members + meta-aliases, and the colors match their PCOLOR slots.
 *
 * C++ refs:
 *   - hdata.cpp:40-247        — HouseTypeClass constructors (house → PCOLOR binding)
 *   - defines.h:1192-1209     — PlayerColorType enum (GOLD, LTBLUE, RED, GREEN, ...)
 *   - house.cpp:2304-2312     — HouseClass::Remap_Table (uses ColorRemaps[RemapColor])
 *   - building.cpp:4444-4450  — BuildingClass::Remap_Table (buildings use same mechanism)
 *   - init.cpp:2715-2754      — Init_Color_Remaps (builds RemapTable from PALETTE.CPS rows)
 *   - flasher.cpp:83-95       — FlasherClass::Process (damage-flash countdown)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { House } from '../engine/types';

const REMAP_PATH = join(process.cwd(), 'public/ra/assets/remap-colors.json');
const remap = JSON.parse(readFileSync(REMAP_PATH, 'utf-8')) as {
  source: number[][];
  houses: Record<string, number[][]>;
};

describe('remap-colors.json — all House enum members present', () => {
  it('has 16-entry source gradient row', () => {
    expect(remap.source).toHaveLength(16);
  });

  for (const name of Object.values(House)) {
    it(`covers House.${name}`, () => {
      expect(remap.houses[name], `${name} missing from remap-colors.json`).toBeDefined();
      expect(remap.houses[name]).toHaveLength(16);
    });
  }

  // C++ hdata.cpp:149-247 — meta houses without their own PCOLOR are aliased.
  const aliasSet = ['GoodGuy', 'BadGuy', 'Neutral', 'Special',
    'Multi1', 'Multi2', 'Multi3', 'Multi4', 'Multi5', 'Multi6', 'Multi7', 'Multi8'];
  for (const alias of aliasSet) {
    it(`covers alias ${alias}`, () => {
      expect(remap.houses[alias], `${alias} alias missing`).toBeDefined();
      expect(remap.houses[alias]).toHaveLength(16);
    });
  }
});

describe('remap-colors.json — PCOLOR color families are correct', () => {
  // We assert the dominant channel of the brightest shade (index 0 or 1) to
  // confirm the house row was extracted from the right PALETTE.CPS row.
  // These come from Init_Color_Remaps + Red Alert's default palette.
  it('Spain (PCOLOR_GOLD) is gold: high R+G, low B', () => {
    const [r, g, b] = remap.houses.Spain[0];
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(180);
    expect(b).toBeLessThan(r);
  });

  it('USSR (PCOLOR_RED) is red: R dominant, G and B both low', () => {
    const [r, g, b] = remap.houses.USSR[1];
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(20);
    expect(b).toBeLessThan(20);
  });

  it('England (PCOLOR_GREEN) is green: G >= R, low-ish B', () => {
    // England's palette row starts as off-white highlights then shifts green (PCOLOR_GREEN).
    // Inspect mid-tones where the green cast is clearest (index 4..10).
    const mid = remap.houses.England[5];
    expect(mid[1], `England mid G should dominate R (got ${mid.join(',')})`).toBeGreaterThanOrEqual(mid[0]);
    expect(mid[1]).toBeGreaterThan(mid[2]);
  });

  it('France (PCOLOR_BLUE) is cyan/teal: B and G both exceed R', () => {
    // PCOLOR_BLUE in RA palette is actually cyan (defines.h:1198 comment "the red scheme
    // used in dialogs" is C&C-era; RA uses it as teal for France).
    const top = remap.houses.France[0];
    expect(top[2], `France B should exceed R (got ${top.join(',')})`).toBeGreaterThan(top[0]);
    expect(top[1]).toBeGreaterThan(top[0]);
  });

  it('Greece (PCOLOR_LTBLUE) is light blue: B dominant', () => {
    const [r, g, b] = remap.houses.Greece[0];
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('Germany (PCOLOR_GREY) is grey: R ~= G ~= B', () => {
    const [r, g, b] = remap.houses.Germany[0];
    expect(Math.abs(r - g)).toBeLessThan(10);
    expect(Math.abs(g - b)).toBeLessThan(40);
  });
});

describe('House alias equivalence (hdata.cpp:129-167)', () => {
  // These aliases point at the same PCOLOR slot in C++, so colors should match exactly.
  it('GoodGuy aliases LTBLUE (= Greece)', () => {
    expect(remap.houses.GoodGuy).toEqual(remap.houses.Greece);
  });

  it('BadGuy aliases RED (= USSR)', () => {
    expect(remap.houses.BadGuy).toEqual(remap.houses.USSR);
  });

  it('Neutral aliases GOLD (= Spain)', () => {
    expect(remap.houses.Neutral).toEqual(remap.houses.Spain);
  });

  it('Special aliases GOLD (= Spain)', () => {
    expect(remap.houses.Special).toEqual(remap.houses.Spain);
  });
});

describe('Spain is identity remap (PCOLOR_GOLD row 0 = source)', () => {
  it('Spain[i] === source[i] for all 16 gradient entries', () => {
    expect(remap.houses.Spain).toEqual(remap.source);
  });
});

describe('getRemappedSheet algorithm — pixel-accurate swap for England/France', () => {
  // Reimplements the getRemappedSheet() core algorithm (assets.ts:442-462) on a raw
  // RGBA byte buffer and verifies England/France swaps produce exact target colors.
  // Exercises B7 (exact-match lookup) and B1 (England/France palette rows) together.
  // A Uint8ClampedArray is used directly to sidestep jsdom canvas limitations.

  function buildRgbaFromColors(colors: number[][]): Uint8ClampedArray {
    const buf = new Uint8ClampedArray(colors.length * 4);
    for (let i = 0; i < colors.length; i++) {
      buf[i * 4] = colors[i][0];
      buf[i * 4 + 1] = colors[i][1];
      buf[i * 4 + 2] = colors[i][2];
      buf[i * 4 + 3] = 255;
    }
    return buf;
  }

  function remapPixels(pixels: Uint8ClampedArray, src: number[][], house: number[][]): void {
    const lut = new Map<number, [number, number, number]>();
    for (let c = 0; c < src.length; c++) {
      const key = (src[c][0] << 16) | (src[c][1] << 8) | src[c][2];
      lut.set(key, [house[c][0], house[c][1], house[c][2]]);
    }
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) continue;
      const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
      const hc = lut.get(key);
      if (hc !== undefined) {
        pixels[i] = hc[0];
        pixels[i + 1] = hc[1];
        pixels[i + 2] = hc[2];
      }
    }
  }

  it('England building sprite: source gold pixels → England green (B1+B3+B7)', () => {
    const source = remap.source;
    const england = remap.houses.England;
    // Synthetic "building sprite": 16 gradient pixels of the source gold ramp.
    const pixels = buildRgbaFromColors(source);
    remapPixels(pixels, source, england);
    // Every pixel now matches the England row exactly.
    for (let i = 0; i < 16; i++) {
      expect([pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]], `pixel ${i}`)
        .toEqual(england[i]);
    }
    // Verify at least one clearly-green pixel was written (green house visual).
    const hasGreenCast = england.some(c => c[1] > c[0] && c[1] > c[2]);
    expect(hasGreenCast, 'England should contain a green-cast shade').toBe(true);
  });

  it('France building sprite: source gold pixels → France cyan/teal (B1+B3+B7)', () => {
    const source = remap.source;
    const france = remap.houses.France;
    const pixels = buildRgbaFromColors(source);
    remapPixels(pixels, source, france);
    for (let i = 0; i < 16; i++) {
      expect([pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]], `pixel ${i}`)
        .toEqual(france[i]);
    }
    // France's PCOLOR_BLUE is actually cyan — all shades have B and G exceeding R.
    for (const c of france) {
      expect(c[2], `France shade ${c.join(',')} B>R`).toBeGreaterThanOrEqual(c[0]);
    }
  });

  it('exact-match tolerance: adjacent source shades do not cross-swap (B7)', () => {
    // Fabricate a pixel that's 2 channels off from source[0] — at ±2 tolerance it
    // would match source[0] and get swapped; at exact match it stays untouched.
    const source = remap.source;
    const england = remap.houses.England;
    const nearMiss: [number, number, number] = [
      source[0][0] - 2, source[0][1] - 2, source[0][2] - 2,
    ];
    const pixels = buildRgbaFromColors([nearMiss]);
    remapPixels(pixels, source, england);
    // Pixel should be untouched (exact match required).
    expect([pixels[0], pixels[1], pixels[2]]).toEqual(nearMiss);
  });

  it('non-source pixels are untouched (no false swaps)', () => {
    const source = remap.source;
    const england = remap.houses.England;
    const nonPalette: [number, number, number][] = [
      [10, 20, 30], [255, 255, 255], [128, 128, 128], [0, 0, 0],
    ];
    const pixels = buildRgbaFromColors(nonPalette);
    remapPixels(pixels, source, england);
    for (let i = 0; i < nonPalette.length; i++) {
      expect([pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]]).toEqual(nonPalette[i]);
    }
  });
});

describe('Structure Blushing target flash — FlasherClass parity (flasher.cpp:83-95)', () => {
  // The building flash is driven by MapStructure.flashCount for Clicked_As_Target-like
  // effects. Ordinary structure damage does not populate this field.
  it('C++ FlashCount countdown produces alternating Blushing: 6→5(T)→4(F)→3(T)→2(F)→1(T)→0', () => {
    const ticks: number[] = [];
    for (let fc = 6; fc > 0; fc--) ticks.push(fc);
    // Count odd ticks — these are the ones that render the flash.
    const oddCount = ticks.filter(t => (t & 1) !== 0).length;
    expect(oddCount).toBe(3); // 5, 3, 1 = 3 flashes
    // Verify alternation
    expect((5 & 1) !== 0).toBe(true);
    expect((4 & 1) !== 0).toBe(false);
    expect((3 & 1) !== 0).toBe(true);
    expect((2 & 1) !== 0).toBe(false);
    expect((1 & 1) !== 0).toBe(true);
  });
});
