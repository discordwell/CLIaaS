/**
 * Sidebar cameo icon tests — verify all icon entries in manifest.json
 * are HIRES (64x48) and that the actual PNG files exist with plausible
 * file sizes. Guards against accidental LORES regression (see 055a2a5).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { PRODUCTION_ITEMS, UNIT_STATS } from '../engine/types';

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

    it(`${name}.png exists and is >800 bytes (HIRES)`, () => {
      const pngPath = resolve(ASSETS_DIR, `${name}.png`);
      const stat = statSync(pngPath);
      expect(stat.size, `${name}.png is too small (${stat.size}b) — LORES regression?`).toBeGreaterThan(800);
    });
  }
});

// Items with no cameo icon — use in-game sprite thumbnails as fallback
// Includes expansion units (SHOK, MECH, CTNK, TTNK, QTNK, DTRK) and FTUR (base game, icon never extracted)
const NO_ICON_ITEMS = new Set(['SHOK', 'MECH', 'CTNK', 'TTNK', 'QTNK', 'DTRK', 'FTUR']);

describe('Production item icon coverage', () => {
  it('all PRODUCTION_ITEMS with icons have a cameo icon in manifest', () => {
    const missing: string[] = [];
    for (const item of PRODUCTION_ITEMS) {
      if (NO_ICON_ITEMS.has(item.type)) continue;
      const iconName = item.type.toLowerCase() + 'icon';
      if (!manifest[iconName]) missing.push(item.type);
    }
    expect(missing, `Missing icons for: ${missing.join(', ')}`).toEqual([]);
  });

  it('items without icons have fallback sprites in manifest', () => {
    for (const type of NO_ICON_ITEMS) {
      const item = PRODUCTION_ITEMS.find(p => p.type === type);
      expect(item, `${type} should be in PRODUCTION_ITEMS`).toBeDefined();
      const iconName = type.toLowerCase() + 'icon';
      expect(manifest[iconName], `${type} should NOT have an icon (uses sprite thumbnail)`).toBeUndefined();
      // Verify the fallback sprite sheet exists in manifest
      const spriteName = item!.isStructure
        ? item!.type.toLowerCase()
        : (UNIT_STATS[item!.type]?.image ?? null);
      expect(spriteName, `${type} must have a fallback sprite name`).toBeTruthy();
      expect(manifest[spriteName!], `${type} fallback sprite "${spriteName}" must exist in manifest`).toBeDefined();
    }
  });
});
