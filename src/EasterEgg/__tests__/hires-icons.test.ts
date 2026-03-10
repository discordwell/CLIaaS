/**
 * HIRES sidebar cameo icon tests — verify all icon entries in manifest.json
 * use 64x48 HIRES dimensions (not 32x24 LORES) and that the actual PNG files
 * exist with plausible HIRES file sizes (>1500 bytes).
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

describe('HIRES sidebar cameo icons', () => {
  it('has at least 60 icon entries in the manifest', () => {
    expect(iconEntries.length).toBeGreaterThanOrEqual(60);
  });

  for (const [name, entry] of iconEntries) {
    it(`${name} has HIRES frame dimensions (64x48)`, () => {
      expect(entry.frameWidth, `${name} frameWidth should be 64`).toBe(64);
      expect(entry.frameHeight, `${name} frameHeight should be 48`).toBe(48);
    });

    it(`${name} has HIRES sheet dimensions (64x48)`, () => {
      expect(entry.sheetWidth, `${name} sheetWidth should be 64`).toBe(64);
      expect(entry.sheetHeight, `${name} sheetHeight should be 48`).toBe(48);
    });

    it(`${name}.png exists and is >1500 bytes (HIRES size)`, () => {
      const pngPath = resolve(ASSETS_DIR, `${name}.png`);
      const stat = statSync(pngPath);
      expect(stat.size, `${name}.png is too small (${stat.size}b) — likely LORES`).toBeGreaterThan(1500);
    });
  }
});
