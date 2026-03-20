/**
 * Sidebar cameo icon tests — verify all icon entries in manifest.json
 * use correct LORES dimensions (32x24) and that the actual PNG files
 * exist with plausible file sizes (>200 bytes).
 *
 * Note: Most icons are LORES (32x24). A few expansion icons (msubicon,
 * stnkicon) are HIRES (64x48) — these are tested separately.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';

const ASSETS_DIR = resolve(__dirname, '../../../public/ra/assets');
const manifest: Record<string, {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  columns: number;
  rows: number;
  sheetWidth: number;
  sheetHeight: number;
}> = JSON.parse(readFileSync(resolve(ASSETS_DIR, 'manifest.json'), 'utf-8'));

const iconEntries = Object.entries(manifest).filter(([name]) => name.endsWith('icon'));

// Icons that are HIRES (64x48) — expansion pack icons rendered at double res
const HIRES_ICONS = new Set(['msubicon', 'stnkicon']);

describe('Sidebar cameo icons', () => {
  it('has at least 60 icon entries in the manifest', () => {
    expect(iconEntries.length).toBeGreaterThanOrEqual(60);
  });

  for (const [name, entry] of iconEntries) {
    if (HIRES_ICONS.has(name)) {
      it(`${name} has HIRES frame dimensions (64x48)`, () => {
        expect(entry.frameWidth, `${name} frameWidth should be 64`).toBe(64);
        expect(entry.frameHeight, `${name} frameHeight should be 48`).toBe(48);
      });

      it(`${name} has HIRES sheet dimensions (64x48)`, () => {
        expect(entry.sheetWidth, `${name} sheetWidth should be 64`).toBe(64);
        expect(entry.sheetHeight, `${name} sheetHeight should be 48`).toBe(48);
      });
    } else {
      it(`${name} has LORES frame dimensions (32x24)`, () => {
        expect(entry.frameWidth, `${name} frameWidth should be 32`).toBe(32);
        expect(entry.frameHeight, `${name} frameHeight should be 24`).toBe(24);
      });

      it(`${name} has LORES sheet dimensions (32x24)`, () => {
        expect(entry.sheetWidth, `${name} sheetWidth should be 32`).toBe(32);
        expect(entry.sheetHeight, `${name} sheetHeight should be 24`).toBe(24);
      });
    }

    it(`${name}.png exists and is >200 bytes`, () => {
      const pngPath = resolve(ASSETS_DIR, `${name}.png`);
      const stat = statSync(pngPath);
      expect(stat.size, `${name}.png is too small (${stat.size}b)`).toBeGreaterThan(200);
    });
  }
});
