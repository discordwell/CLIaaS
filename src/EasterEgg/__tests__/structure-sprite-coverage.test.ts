/**
 * Structure sprite coverage tests — verify all structure types used in ant mission
 * INI files have proper entries in STRUCTURE_IMAGES, STRUCTURE_SIZE, and
 * BUILDING_FRAME_TABLE so they render as sprites instead of colored rectangles.
 *
 * Bug fix: FCOM (Forward Command Post) in SCA03EA.ini was missing from all three
 * tables, causing a yellow/brown box to render instead of the building sprite.
 * V01-V18 civilian structures now have sprites extracted from TEMPERAT.MIX.
 *
 * BARL/BRL3 (explosive/bridge barrels) now have procedurally generated sprites
 * via scripts/generate-barrel-sprites.ts with full STRUCTURE_IMAGES, BUILDING_FRAME_TABLE,
 * and manifest.json coverage.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ASSETS_DIR = join(__dirname, '../../../public/ra/assets');
const manifest = JSON.parse(readFileSync(join(ASSETS_DIR, 'manifest.json'), 'utf-8'));

// Import the tables under test directly (no source parsing needed)
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP, STRUCTURE_IMAGES as _STRUCTURE_IMAGES } from '../engine/scenario';
import { BUILDING_FRAME_TABLE as _BUILDING_FRAME_TABLE } from '../engine/renderer';

// Structure types actually placed in ant mission INI [STRUCTURES] sections
function parseIniStructureTypes(filename: string): Set<string> {
  const content = readFileSync(join(ASSETS_DIR, filename), 'utf-8');
  const structSection = content.match(/\[STRUCTURES\]\r?\n([\s\S]*?)(?:\r?\n\[|$)/);
  if (!structSection) return new Set();
  const types = new Set<string>();
  for (const line of structSection[1].split(/\r?\n/)) {
    const m = line.match(/^\d+=\w+,(\w+),/);
    if (m) types.add(m[1]);
  }
  return types;
}

const STRUCTURE_IMAGES = new Set(Object.keys(_STRUCTURE_IMAGES));
const BUILDING_FRAME_TABLE = new Set(Object.keys(_BUILDING_FRAME_TABLE));

// Wall types handled by separate rendering code (not BUILDING_FRAME_TABLE)
const WALL_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK', 'WOOD']);
// Turret buildings handled by special rendering code
const TURRET_TYPES = new Set(['GUN', 'SAM', 'AGUN']);
// Bridge/barrel structures now have procedurally generated sprites
const BRIDGE_TYPES = new Set<string>();  // empty — BARL/BRL3 now have full sprite coverage

const INI_FILES = ['SCA01EA.ini', 'SCA02EA.ini', 'SCA03EA.ini', 'SCA04EA.ini'];

describe('Structure sprite coverage for ant missions', () => {
  // Collect all structure types across all ant mission INIs
  const allTypes = new Set<string>();
  for (const f of INI_FILES) {
    for (const t of parseIniStructureTypes(f)) allTypes.add(t);
  }

  // Filter to types that need rendering (exclude bridges without sprites)
  const renderableTypes = [...allTypes].filter(
    t => !BRIDGE_TYPES.has(t)
  );

  it('FCOM is in STRUCTURE_IMAGES', () => {
    expect(STRUCTURE_IMAGES.has('FCOM')).toBe(true);
  });

  it('FCOM is in STRUCTURE_SIZE as 2x2', () => {
    expect(STRUCTURE_SIZE['FCOM']).toEqual([2, 2]);
  });

  it('FCOM is in STRUCTURE_MAX_HP', () => {
    expect(STRUCTURE_MAX_HP['FCOM']).toBeDefined();
    expect(STRUCTURE_MAX_HP['FCOM']).toBeGreaterThan(0);
  });

  it('fcom is in BUILDING_FRAME_TABLE', () => {
    expect(BUILDING_FRAME_TABLE.has('fcom')).toBe(true);
  });

  it('fcom sprite exists in manifest with 2 frames', () => {
    expect(manifest['fcom']).toBeDefined();
    expect(manifest['fcom'].frameCount).toBe(2);
  });

  it('BARL is in STRUCTURE_IMAGES', () => {
    expect(STRUCTURE_IMAGES.has('BARL')).toBe(true);
  });

  it('BRL3 is in STRUCTURE_IMAGES', () => {
    expect(STRUCTURE_IMAGES.has('BRL3')).toBe(true);
  });

  it('barl is in BUILDING_FRAME_TABLE', () => {
    expect(BUILDING_FRAME_TABLE.has('barl')).toBe(true);
  });

  it('brl3 is in BUILDING_FRAME_TABLE', () => {
    expect(BUILDING_FRAME_TABLE.has('brl3')).toBe(true);
  });

  it('barl sprite exists in manifest with 3 frames', () => {
    expect(manifest['barl']).toBeDefined();
    expect(manifest['barl'].frameCount).toBe(3);
  });

  it('brl3 sprite exists in manifest with 3 frames', () => {
    expect(manifest['brl3']).toBeDefined();
    expect(manifest['brl3'].frameCount).toBe(3);
  });

  it('BARL/BRL3 are 1x1 in STRUCTURE_SIZE', () => {
    expect(STRUCTURE_SIZE['BARL']).toEqual([1, 1]);
    expect(STRUCTURE_SIZE['BRL3']).toEqual([1, 1]);
  });

  it('BARL/BRL3 have low HP for barrel explosions', () => {
    expect(STRUCTURE_MAX_HP['BARL']).toBeDefined();
    expect(STRUCTURE_MAX_HP['BARL']).toBeLessThanOrEqual(50);
    expect(STRUCTURE_MAX_HP['BRL3']).toBeDefined();
    expect(STRUCTURE_MAX_HP['BRL3']).toBeLessThanOrEqual(50);
  });

  it('V19 (oil pump) is in STRUCTURE_IMAGES', () => {
    expect(STRUCTURE_IMAGES.has('V19')).toBe(true);
  });

  it('v19 is in BUILDING_FRAME_TABLE', () => {
    expect(BUILDING_FRAME_TABLE.has('v19')).toBe(true);
  });

  it('MISS (church) is in STRUCTURE_IMAGES', () => {
    expect(STRUCTURE_IMAGES.has('MISS')).toBe(true);
  });

  for (const t of renderableTypes) {
    const lower = t.toLowerCase();
    const isWall = WALL_TYPES.has(t);
    const isTurret = TURRET_TYPES.has(t);

    it(`${t} has a sprite in the manifest`, () => {
      expect(manifest[lower], `${lower}.png missing from manifest`).toBeDefined();
    });

    it(`${t} is in STRUCTURE_IMAGES or resolves via lowercase fallback`, () => {
      // Either explicitly mapped or the lowercase matches a manifest entry
      const hasExplicit = STRUCTURE_IMAGES.has(t);
      const hasFallback = manifest[lower] !== undefined;
      expect(
        hasExplicit || hasFallback,
        `${t} has no STRUCTURE_IMAGES entry and no manifest entry for '${lower}'`
      ).toBe(true);
    });

    if (!isWall && !isTurret) {
      it(`${lower} is in BUILDING_FRAME_TABLE or has renderer fallback`, () => {
        const inTable = BUILDING_FRAME_TABLE.has(lower);
        // Renderer fallback: 2 frames → frame 0/1, >2 frames → frame 0 / floor(total/2)
        const hasRendererFallback = manifest[lower]?.frameCount >= 2;
        expect(
          inTable || hasRendererFallback,
          `${lower} not in BUILDING_FRAME_TABLE and doesn't have ≥2 frames for renderer fallback`
        ).toBe(true);
      });
    }
  }

  it('V01-V18 civilian structures have sprites in manifest', () => {
    for (let i = 1; i <= 18; i++) {
      const key = `v${String(i).padStart(2, '0')}`;
      expect(manifest[key], `${key} should be in manifest`).toBeDefined();
      expect(manifest[key].frameCount).toBeGreaterThanOrEqual(2);
    }
  });
});
