/**
 * Sidebar cameo icon tests — verify all icon entries in manifest.json
 * are HIRES (64x48) and that the actual PNG files exist with plausible
 * file sizes. Guards against accidental LORES regression (see 055a2a5).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { PRODUCTION_ITEMS } from '../engine/types';

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

describe('Sidebar cameo icons', () => {
  it('has at least 60 icon entries in the manifest', () => {
    expect(iconEntries.length).toBeGreaterThanOrEqual(60);
  });

  for (const [name, entry] of iconEntries) {
    it(`${name} has HIRES frame dimensions (64x48)`, () => {
      expect(entry.frameWidth, `${name} frameWidth should be 64 — LORES regression?`).toBe(64);
      expect(entry.frameHeight, `${name} frameHeight should be 48 — LORES regression?`).toBe(48);
    });

    it(`${name} has HIRES sheet dimensions (64x48)`, () => {
      expect(entry.sheetWidth, `${name} sheetWidth should be 64`).toBe(64);
      expect(entry.sheetHeight, `${name} sheetHeight should be 48`).toBe(48);
    });

    it(`${name}.png exists and is non-trivial`, () => {
      const pngPath = resolve(ASSETS_DIR, `${name}.png`);
      const stat = statSync(pngPath);
      expect(stat.size, `${name}.png is too small (${stat.size}b)`).toBeGreaterThan(200);
    });
  }
});

describe('Production item icon coverage', () => {
  it('every PRODUCTION_ITEM has a cameo icon in manifest', () => {
    const missing: string[] = [];
    for (const item of PRODUCTION_ITEMS) {
      const iconName = item.type.toLowerCase() + 'icon';
      if (!manifest[iconName]) missing.push(item.type);
    }
    expect(missing, `Missing icons for: ${missing.join(', ')}`).toEqual([]);
  });
});
