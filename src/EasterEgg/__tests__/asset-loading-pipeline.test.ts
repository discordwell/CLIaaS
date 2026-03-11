/**
 * Asset Loading Pipeline Tests
 *
 * Comprehensive test suite for the AssetManager system in the RA TypeScript engine.
 * Tests cover:
 * - AssetManager construction and initialization state
 * - Manifest structure validation and parsing
 * - Sprite sheet metadata integrity (dimensions, frame counts, layout math)
 * - UNIT_STATS image references resolve to manifest entries
 * - Frame extraction math (column/row layout, source rect calculation)
 * - Palette and tileset file existence
 * - House color remap data structure
 * - Asset URL construction (BASE_URL = /ra/assets)
 * - Cache behavior (loadAll idempotency)
 * - Error handling (missing assets, failed fetches)
 * - Multi-house color remap plumbing
 * - SHP-related data validation (frame counts match between types.ts and manifest)
 *
 * Note: Tests that exercise the actual loading pipeline mock fetch/Image
 * since AssetManager runs in a browser context. Pure data validation tests
 * read the manifest and types directly (no mocks needed).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Direct imports for pure data validation
import { UNIT_STATS } from '../engine/types';
import type { AssetManifest, SpriteSheetMeta } from '../engine/assets';

// ── Shared test data ──────────────────────────────────────────────────────────

const ASSETS_DIR = join(__dirname, '../../../public/ra/assets');
const manifest: AssetManifest = JSON.parse(
  readFileSync(join(ASSETS_DIR, 'manifest.json'), 'utf-8'),
);

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Manifest structure validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Manifest JSON structure', () => {
  it('manifest is a non-empty object', () => {
    expect(typeof manifest).toBe('object');
    expect(manifest).not.toBeNull();
    expect(Object.keys(manifest).length).toBeGreaterThan(0);
  });

  it('manifest has at least 100 entries (units + structures + effects + UI)', () => {
    expect(Object.keys(manifest).length).toBeGreaterThan(100);
  });

  it('every manifest entry has all required SpriteSheetMeta fields', () => {
    const requiredFields: (keyof SpriteSheetMeta)[] = [
      'frameWidth', 'frameHeight', 'frameCount', 'columns', 'rows', 'sheetWidth', 'sheetHeight',
    ];
    for (const [name, meta] of Object.entries(manifest)) {
      for (const field of requiredFields) {
        expect(meta[field], `${name} missing field '${field}'`).toBeDefined();
        expect(typeof meta[field], `${name}.${field} should be a number`).toBe('number');
      }
    }
  });

  it('every manifest entry has positive frame dimensions', () => {
    for (const [name, meta] of Object.entries(manifest)) {
      expect(meta.frameWidth, `${name}.frameWidth`).toBeGreaterThan(0);
      expect(meta.frameHeight, `${name}.frameHeight`).toBeGreaterThan(0);
      expect(meta.frameCount, `${name}.frameCount`).toBeGreaterThan(0);
    }
  });

  it('every manifest entry has integer values for all fields', () => {
    for (const [name, meta] of Object.entries(manifest)) {
      expect(Number.isInteger(meta.frameWidth), `${name}.frameWidth should be integer`).toBe(true);
      expect(Number.isInteger(meta.frameHeight), `${name}.frameHeight should be integer`).toBe(true);
      expect(Number.isInteger(meta.frameCount), `${name}.frameCount should be integer`).toBe(true);
      expect(Number.isInteger(meta.columns), `${name}.columns should be integer`).toBe(true);
      expect(Number.isInteger(meta.rows), `${name}.rows should be integer`).toBe(true);
      expect(Number.isInteger(meta.sheetWidth), `${name}.sheetWidth should be integer`).toBe(true);
      expect(Number.isInteger(meta.sheetHeight), `${name}.sheetHeight should be integer`).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Sprite sheet layout math consistency
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sprite sheet layout math', () => {
  it('sheetWidth === columns * frameWidth for every entry', () => {
    for (const [name, meta] of Object.entries(manifest)) {
      expect(
        meta.sheetWidth,
        `${name}: sheetWidth (${meta.sheetWidth}) !== columns (${meta.columns}) * frameWidth (${meta.frameWidth})`,
      ).toBe(meta.columns * meta.frameWidth);
    }
  });

  it('sheetHeight === rows * frameHeight for every entry', () => {
    for (const [name, meta] of Object.entries(manifest)) {
      expect(
        meta.sheetHeight,
        `${name}: sheetHeight (${meta.sheetHeight}) !== rows (${meta.rows}) * frameHeight (${meta.frameHeight})`,
      ).toBe(meta.rows * meta.frameHeight);
    }
  });

  it('columns * rows >= frameCount for every entry (sheet has room for all frames)', () => {
    for (const [name, meta] of Object.entries(manifest)) {
      const capacity = meta.columns * meta.rows;
      expect(
        capacity,
        `${name}: capacity (${capacity}) < frameCount (${meta.frameCount})`,
      ).toBeGreaterThanOrEqual(meta.frameCount);
    }
  });

  it('frame index fits within grid for every entry', () => {
    // The last frame index should map to a valid (col, row) within the sheet
    for (const [name, meta] of Object.entries(manifest)) {
      const lastIdx = meta.frameCount - 1;
      const col = lastIdx % meta.columns;
      const row = Math.floor(lastIdx / meta.columns);
      expect(col, `${name} last frame col out of range`).toBeLessThan(meta.columns);
      expect(row, `${name} last frame row out of range`).toBeLessThan(meta.rows);
    }
  });

  it('frame source rect fits within sheet dimensions', () => {
    for (const [name, meta] of Object.entries(manifest)) {
      const lastIdx = meta.frameCount - 1;
      const col = lastIdx % meta.columns;
      const row = Math.floor(lastIdx / meta.columns);
      const sx = col * meta.frameWidth;
      const sy = row * meta.frameHeight;
      expect(sx + meta.frameWidth, `${name} last frame exceeds sheetWidth`).toBeLessThanOrEqual(meta.sheetWidth);
      expect(sy + meta.frameHeight, `${name} last frame exceeds sheetHeight`).toBeLessThanOrEqual(meta.sheetHeight);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. UNIT_STATS image references → manifest coverage
// ═══════════════════════════════════════════════════════════════════════════════

describe('UNIT_STATS image → manifest coverage', () => {
  // Collect all unique image keys referenced by UNIT_STATS
  const imageKeys = new Set<string>();
  for (const stats of Object.values(UNIT_STATS)) {
    if (stats.image) imageKeys.add(stats.image);
  }

  it('every unique image key in UNIT_STATS has a manifest entry', () => {
    for (const key of imageKeys) {
      expect(manifest[key], `UNIT_STATS references image '${key}' which is missing from manifest`).toBeDefined();
    }
  });

  // Parameterized: every individual unit type
  for (const [unitKey, stats] of Object.entries(UNIT_STATS)) {
    if (!stats.image) continue;
    it(`${unitKey} (image='${stats.image}') exists in manifest with >0 frames`, () => {
      const entry = manifest[stats.image];
      expect(entry, `${stats.image} missing from manifest`).toBeDefined();
      expect(entry.frameCount, `${stats.image} has 0 frames`).toBeGreaterThan(0);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Vehicle sprite frame counts (32-facing or 64-frame turret vehicles)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Vehicle sprite frame counts', () => {
  // Vehicles with turret (body 32 + turret 32 = 64 frames)
  const TURRET_VEHICLES: [string, number][] = [
    ['1tnk', 64], ['2tnk', 64], ['3tnk', 64], ['4tnk', 64],
    ['jeep', 64], ['ttnk', 64],
  ];

  for (const [sprite, expected] of TURRET_VEHICLES) {
    it(`${sprite} has ${expected} frames (body + turret facings)`, () => {
      expect(manifest[sprite]?.frameCount, `${sprite} frame count`).toBe(expected);
    });
  }

  // Vehicles with only body facings (32 frames)
  const BODY_ONLY_VEHICLES: [string, number][] = [
    ['arty', 32], ['truk', 32], ['mcv', 32], ['stnk', 32],
    ['ctnk', 32], ['dtrk', 32],
  ];

  for (const [sprite, expected] of BODY_ONLY_VEHICLES) {
    it(`${sprite} has ${expected} frames (body-only facings)`, () => {
      expect(manifest[sprite]?.frameCount, `${sprite} frame count`).toBe(expected);
    });
  }

  // Naval vessels (16 facings)
  const NAVAL_16: [string, number][] = [
    ['ss', 16], ['dd', 16], ['ca', 16], ['pt', 16], ['msub', 16],
  ];

  for (const [sprite, expected] of NAVAL_16) {
    it(`${sprite} has ${expected} frames (16 naval facings)`, () => {
      expect(manifest[sprite]?.frameCount, `${sprite} frame count`).toBe(expected);
    });
  }

  // Aircraft (16 facings for fixed-wing)
  const AIRCRAFT_16: [string, number][] = [
    ['mig', 16], ['yak', 16],
  ];

  for (const [sprite, expected] of AIRCRAFT_16) {
    it(`${sprite} has ${expected} frames (16 fixed-wing facings)`, () => {
      expect(manifest[sprite]?.frameCount, `${sprite} frame count`).toBe(expected);
    });
  }

  // Helicopters (32 facings for rotorcraft)
  const HELI_32: [string, number][] = [
    ['heli', 32], ['hind', 32],
  ];

  for (const [sprite, expected] of HELI_32) {
    it(`${sprite} has ${expected} frames (32 helicopter facings)`, () => {
      expect(manifest[sprite]?.frameCount, `${sprite} frame count`).toBe(expected);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Infantry sprite frame counts (multi-action animation sequences)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Infantry sprite frame counts', () => {
  // Infantry sprites have many animation actions, so frame count is high
  const INFANTRY_SPRITES: [string, number][] = [
    ['e1', 438], ['e2', 566], ['e3', 454], ['e4', 566],
    ['e6', 248], ['dog', 268], ['spy', 342], ['medi', 247],
    ['shok', 316], ['c1', 198], ['c2', 198],
    ['einstein', 165], ['gnrl', 264],
  ];

  for (const [sprite, expected] of INFANTRY_SPRITES) {
    it(`${sprite} has ${expected} frames`, () => {
      expect(manifest[sprite]?.frameCount, `${sprite} frame count`).toBe(expected);
    });
  }

  // Infantry all share 50x39 frame size (RA SHP standard for infantry)
  const INFANTRY_50x39 = ['e1', 'e2', 'e3', 'e4', 'e6', 'dog', 'spy', 'medi', 'shok', 'c1', 'c2', 'einstein', 'gnrl'];

  for (const sprite of INFANTRY_50x39) {
    it(`${sprite} uses 50x39 infantry frame dimensions`, () => {
      expect(manifest[sprite]?.frameWidth, `${sprite} frameWidth`).toBe(50);
      expect(manifest[sprite]?.frameHeight, `${sprite} frameHeight`).toBe(39);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Ant sprite validation (already in ant-sprite-manifest.test.ts, but
//    we test the cross-reference from UNIT_STATS here)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Ant unit image cross-reference', () => {
  it('ANT1 stats.image matches ant1 manifest entry', () => {
    expect(UNIT_STATS.ANT1.image).toBe('ant1');
    expect(manifest['ant1'].frameCount).toBe(112);
    expect(manifest['ant1'].frameWidth).toBe(48);
    expect(manifest['ant1'].frameHeight).toBe(48);
  });

  it('ANT2 stats.image matches ant2 manifest entry', () => {
    expect(UNIT_STATS.ANT2.image).toBe('ant2');
    expect(manifest['ant2'].frameCount).toBe(112);
  });

  it('ANT3 stats.image matches ant3 manifest entry', () => {
    expect(UNIT_STATS.ANT3.image).toBe('ant3');
    expect(manifest['ant3'].frameCount).toBe(112);
  });

  it('antdie death animation exists in manifest', () => {
    expect(manifest['antdie']).toBeDefined();
    expect(manifest['antdie'].frameCount).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Asset file existence on disk (PNG files for each manifest entry)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Asset PNG files exist on disk', () => {
  // Sample critical sprites (not exhaustive — ant-sprite-manifest.test.ts covers ants)
  const CRITICAL_SPRITES = [
    '1tnk', '2tnk', '3tnk', '4tnk', 'jeep', 'apc', 'harv', 'mcv', 'arty', 'truk',
    'e1', 'e2', 'e3', 'e4', 'e6', 'dog', 'spy', 'medi',
    'fact', 'powr', 'tent', 'barr', 'weap', 'proc', 'dome',
    'mig', 'yak', 'heli', 'hind', 'tran',
    'ss', 'dd', 'ca', 'pt',
  ];

  for (const name of CRITICAL_SPRITES) {
    it(`${name}.png exists on disk`, () => {
      const pngPath = join(ASSETS_DIR, `${name}.png`);
      expect(existsSync(pngPath), `${name}.png missing from ${ASSETS_DIR}`).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Palette and tileset files
// ═══════════════════════════════════════════════════════════════════════════════

describe('Palette and tileset files', () => {
  it('palette.json exists and is a valid JSON array', () => {
    const palettePath = join(ASSETS_DIR, 'palette.json');
    expect(existsSync(palettePath), 'palette.json missing').toBe(true);
    const palette = JSON.parse(readFileSync(palettePath, 'utf-8'));
    expect(Array.isArray(palette)).toBe(true);
    expect(palette.length).toBe(256); // RA palette is 256 entries
  });

  it('each palette entry is an RGBA quadruplet [r, g, b, a]', () => {
    const palette = JSON.parse(readFileSync(join(ASSETS_DIR, 'palette.json'), 'utf-8'));
    for (let i = 0; i < palette.length; i++) {
      expect(Array.isArray(palette[i]), `palette[${i}] should be array`).toBe(true);
      expect(palette[i].length, `palette[${i}] should have 4 components (RGBA)`).toBe(4);
      for (let c = 0; c < 4; c++) {
        expect(palette[i][c], `palette[${i}][${c}] should be 0-255`).toBeGreaterThanOrEqual(0);
        expect(palette[i][c], `palette[${i}][${c}] should be 0-255`).toBeLessThanOrEqual(255);
      }
    }
  });

  it('TEMPERATE tileset.json exists and has required fields', () => {
    const tilesetPath = join(ASSETS_DIR, 'tileset.json');
    if (!existsSync(tilesetPath)) return; // skip if not extracted
    const meta = JSON.parse(readFileSync(tilesetPath, 'utf-8'));
    expect(meta.tileW).toBe(24);
    expect(meta.tileH).toBe(24);
    expect(meta.tileCount).toBeGreaterThan(0);
    expect(typeof meta.tiles).toBe('object');
    expect(meta.atlasW).toBeGreaterThan(0);
    expect(meta.atlasH).toBeGreaterThan(0);
  });

  it('TEMPERATE tileset.png exists', () => {
    expect(existsSync(join(ASSETS_DIR, 'tileset.png'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. House color remap data structure
// ═══════════════════════════════════════════════════════════════════════════════

describe('House color remap data', () => {
  const remapPath = join(ASSETS_DIR, 'remap-colors.json');
  const hasRemap = existsSync(remapPath);

  it.skipIf(!hasRemap)('remap-colors.json has source array of 16 RGB colors', () => {
    const data = JSON.parse(readFileSync(remapPath, 'utf-8'));
    expect(Array.isArray(data.source)).toBe(true);
    expect(data.source.length).toBe(16);
    for (const color of data.source) {
      expect(color).toHaveLength(3);
    }
  });

  it.skipIf(!hasRemap)('remap-colors.json has house entries with 16 colors each', () => {
    const data = JSON.parse(readFileSync(remapPath, 'utf-8'));
    expect(typeof data.houses).toBe('object');
    const houseNames = Object.keys(data.houses);
    expect(houseNames.length).toBeGreaterThan(0);
    for (const house of houseNames) {
      expect(
        data.houses[house].length,
        `house '${house}' should have 16 remap colors`,
      ).toBe(16);
      for (const color of data.houses[house]) {
        expect(color).toHaveLength(3);
      }
    }
  });

  it.skipIf(!hasRemap)('remap-colors.json includes Spain and USSR houses', () => {
    const data = JSON.parse(readFileSync(remapPath, 'utf-8'));
    expect(data.houses['Spain']).toBeDefined();
    expect(data.houses['USSR']).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Building construction animation sprites ("*make" entries)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Building construction animation sprites', () => {
  const BUILDINGS_WITH_MAKE = [
    'fact', 'powr', 'apwr', 'barr', 'tent', 'weap', 'proc', 'silo',
    'dome', 'fix', 'gun', 'sam', 'tsla', 'agun', 'gap', 'pbox',
    'hpad', 'afld', 'atek', 'stek', 'iron', 'pdox', 'kenn',
    'syrd', 'spen', 'bio', 'hosp', 'hbox', 'mslo',
  ];

  for (const building of BUILDINGS_WITH_MAKE) {
    const makeName = `${building}make`;
    it(`${building} has a construction animation (${makeName}) in manifest`, () => {
      expect(manifest[makeName], `${makeName} missing from manifest`).toBeDefined();
      expect(manifest[makeName]?.frameCount, `${makeName} should have >0 frames`).toBeGreaterThan(0);
    });

    it(`${makeName} frame dimensions match ${building} base sprite`, () => {
      if (!manifest[building] || !manifest[makeName]) return;
      expect(manifest[makeName].frameWidth, `${makeName} frameWidth`).toBe(manifest[building].frameWidth);
      expect(manifest[makeName].frameHeight, `${makeName} frameHeight`).toBe(manifest[building].frameHeight);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Sidebar / UI icon sprites
// ═══════════════════════════════════════════════════════════════════════════════

describe('Production sidebar icon sprites', () => {
  // Unit icons used in the sidebar production queue
  const UNIT_ICONS = [
    '1tnkicon', '2tnkicon', '3tnkicon', '4tnkicon',
    'jeepicon', 'apcicon', 'harvicon', 'mcvicon', 'artyicon', 'trukicon',
    'e1icon', 'e2icon', 'e3icon', 'e4icon', 'e6icon', 'dogicon', 'spyicon', 'mediicon',
    'ssicon', 'ddicon', 'caicon', 'pticon', 'lsticon',
    'hindicon', 'heliicon', 'tranicon', 'migicon', 'yakicon',
  ];

  for (const icon of UNIT_ICONS) {
    it(`${icon} exists in manifest as 64x48 single frame`, () => {
      const entry = manifest[icon];
      expect(entry, `${icon} missing from manifest`).toBeDefined();
      if (entry) {
        expect(entry.frameWidth).toBe(64);
        expect(entry.frameHeight).toBe(48);
        expect(entry.frameCount).toBe(1);
      }
    });
  }

  // Structure icons
  const STRUCTURE_ICONS = [
    'facticon', 'powricon', 'apwricon', 'barricon', 'tenticon', 'weapicon',
    'procicon', 'siloicon',
  ];

  for (const icon of STRUCTURE_ICONS) {
    it(`${icon} exists in manifest`, () => {
      expect(manifest[icon], `${icon} missing from manifest`).toBeDefined();
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. VFX / projectile / explosion sprites
// ═══════════════════════════════════════════════════════════════════════════════

describe('Visual effect sprites', () => {
  const VFX_SPRITES: [string, number][] = [
    ['fball1', 18],    // fireball explosion
    ['piff', 4],       // small bullet hit
    ['piffpiff', 8],   // double hit
    ['napalm1', 14],   // small napalm
    ['napalm2', 14],   // medium napalm
    ['napalm3', 14],   // large napalm
    ['atomsfx', 27],   // nuclear explosion
    ['smokey', 7],     // smoke puff
    ['litning', 8],    // tesla lightning
    ['frag1', 14],     // fragment explosion
    ['art-exp1', 22],  // artillery explosion
  ];

  for (const [sprite, expected] of VFX_SPRITES) {
    it(`${sprite} has ${expected} animation frames`, () => {
      expect(manifest[sprite]?.frameCount, `${sprite} frame count`).toBe(expected);
    });
  }

  // Fire animations (looping)
  for (const fire of ['fire1', 'fire2', 'fire3']) {
    it(`${fire} has 15 frames for looping fire`, () => {
      expect(manifest[fire]?.frameCount).toBe(15);
      expect(manifest[fire]?.frameWidth).toBe(23);
      expect(manifest[fire]?.frameHeight).toBe(23);
    });
  }

  // Projectile sprites
  const PROJECTILES: string[] = ['dragon', 'missile', 'bomb', 'bomblet'];
  for (const proj of PROJECTILES) {
    it(`projectile sprite '${proj}' exists in manifest`, () => {
      expect(manifest[proj], `${proj} missing from manifest`).toBeDefined();
      expect(manifest[proj]?.frameCount).toBeGreaterThan(0);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Ore and gem sprites
// ═══════════════════════════════════════════════════════════════════════════════

describe('Ore and gem resource sprites', () => {
  for (let i = 1; i <= 4; i++) {
    const goldName = `gold0${i}`;
    it(`${goldName} has 12 growth frames at 24x24`, () => {
      expect(manifest[goldName]).toBeDefined();
      expect(manifest[goldName]?.frameCount).toBe(12);
      expect(manifest[goldName]?.frameWidth).toBe(24);
      expect(manifest[goldName]?.frameHeight).toBe(24);
    });

    const gemName = `gem0${i}`;
    it(`${gemName} has 3 growth frames at 24x24`, () => {
      expect(manifest[gemName]).toBeDefined();
      expect(manifest[gemName]?.frameCount).toBe(3);
      expect(manifest[gemName]?.frameWidth).toBe(24);
      expect(manifest[gemName]?.frameHeight).toBe(24);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. Tree sprites (terrain objects)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tree terrain object sprites', () => {
  // Trees t01-t17 (some gaps expected, e.g. t04 may not exist)
  const TREES_WITH_10_FRAMES = ['t01', 't02', 't03', 't05', 't06', 't07', 't10', 't12', 't13', 't14', 't16', 't17'];

  for (const tree of TREES_WITH_10_FRAMES) {
    it(`${tree} has 10 frames (undamaged/damaged cycle)`, () => {
      expect(manifest[tree]?.frameCount, `${tree} frame count`).toBe(10);
    });
  }

  // Large trees
  for (const tree of ['tc01', 'tc02', 'tc03']) {
    it(`${tree} is a 72x48 large tree with 10 frames`, () => {
      expect(manifest[tree]?.frameWidth).toBe(72);
      expect(manifest[tree]?.frameHeight).toBe(48);
      expect(manifest[tree]?.frameCount).toBe(10);
    });
  }

  // Extra-large trees
  for (const tree of ['tc04', 'tc05']) {
    it(`${tree} is a 96x72 extra-large tree with 10 frames`, () => {
      expect(manifest[tree]?.frameWidth).toBe(96);
      expect(manifest[tree]?.frameHeight).toBe(72);
      expect(manifest[tree]?.frameCount).toBe(10);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. Wall sprites
// ═══════════════════════════════════════════════════════════════════════════════

describe('Wall type sprites', () => {
  const WALLS: [string, number][] = [
    ['sbag', 32], ['fenc', 32], ['barb', 32], ['wood', 32], ['brik', 64], ['cycl', 48],
  ];

  for (const [wall, expected] of WALLS) {
    it(`${wall} has ${expected} frames for connection variants`, () => {
      expect(manifest[wall]?.frameCount, `${wall} frame count`).toBe(expected);
      expect(manifest[wall]?.frameWidth, `${wall} is 24px wide`).toBe(24);
      expect(manifest[wall]?.frameHeight, `${wall} is 24px tall`).toBe(24);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. AssetManager class — construction and loading behavior (with mocks)
// ═══════════════════════════════════════════════════════════════════════════════

// Dynamic import to avoid module-level side effects from DOM globals
// The AssetManager class itself works fine — we just mock fetch/Image
describe('AssetManager class behavior', () => {
  // We test the class in isolation by instantiating it and checking state
  // without calling loadAll (which requires browser fetch + Image)

  let AssetManager: typeof import('../engine/assets').AssetManager;
  let getSharedAssets: typeof import('../engine/assets').getSharedAssets;

  beforeEach(async () => {
    // Fresh import each time to avoid singleton leaks
    vi.resetModules();
    const mod = await import('../engine/assets');
    AssetManager = mod.AssetManager;
    getSharedAssets = mod.getSharedAssets;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('newly constructed AssetManager has isLoaded === false', () => {
    const mgr = new AssetManager();
    expect(mgr.isLoaded).toBe(false);
  });

  it('newly constructed AssetManager returns null for getPalette()', () => {
    const mgr = new AssetManager();
    expect(mgr.getPalette()).toBeNull();
  });

  it('newly constructed AssetManager returns undefined for getSheet()', () => {
    const mgr = new AssetManager();
    expect(mgr.getSheet('1tnk')).toBeUndefined();
  });

  it('newly constructed AssetManager hasSheet returns false', () => {
    const mgr = new AssetManager();
    expect(mgr.hasSheet('1tnk')).toBe(false);
  });

  it('newly constructed AssetManager has no tileset', () => {
    const mgr = new AssetManager();
    expect(mgr.hasTileset()).toBe(false);
    expect(mgr.getTilesetImage()).toBeNull();
    expect(mgr.getTilesetMeta()).toBeNull();
  });

  it('newly constructed AssetManager has no theatre tileset', () => {
    const mgr = new AssetManager();
    expect(mgr.hasTileset('SNOW')).toBe(false);
    expect(mgr.getTilesetImage('SNOW')).toBeNull();
    expect(mgr.getTilesetMeta('SNOW')).toBeNull();
  });

  it('getTheatrePalette falls back to null when no palettes loaded', () => {
    const mgr = new AssetManager();
    expect(mgr.getTheatrePalette('SNOW')).toBeNull();
    expect(mgr.getTheatrePalette('TEMPERATE')).toBeNull();
  });

  it('hasRemapData is false before loading', () => {
    const mgr = new AssetManager();
    expect(mgr.hasRemapData).toBe(false);
  });

  it('getRemappedSheet returns null when no remap data loaded', () => {
    const mgr = new AssetManager();
    expect(mgr.getRemappedSheet('1tnk', 'Spain')).toBeNull();
  });

  it('getShadowSheet returns null for missing sheet', () => {
    const mgr = new AssetManager();
    expect(mgr.getShadowSheet('nonexistent')).toBeNull();
  });

  it('drawFrame silently returns when sheet not loaded (no throw)', () => {
    const mgr = new AssetManager();
    // drawFrame should not throw when the sheet is missing
    expect(() => {
      mgr.drawFrame(null as any, 'missing_sheet', 0, 0, 0);
    }).not.toThrow();
  });

  it('drawFrameFrom silently returns when sheet not loaded (no throw)', () => {
    const mgr = new AssetManager();
    expect(() => {
      mgr.drawFrameFrom(null as any, null as any, 'missing_sheet', 0, 0, 0);
    }).not.toThrow();
  });

  it('getSharedAssets returns the same instance on repeated calls', () => {
    const a = getSharedAssets();
    const b = getSharedAssets();
    expect(a).toBe(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. AssetManager loadAll with mocked fetch + Image
// ═══════════════════════════════════════════════════════════════════════════════

describe('AssetManager.loadAll with mocked network', () => {
  let AssetManager: typeof import('../engine/assets').AssetManager;

  // Minimal manifest for testing loading pipeline
  const MINI_MANIFEST: AssetManifest = {
    '1tnk': { frameWidth: 24, frameHeight: 24, frameCount: 64, columns: 16, rows: 4, sheetWidth: 384, sheetHeight: 96 },
    'e1': { frameWidth: 50, frameHeight: 39, frameCount: 438, columns: 16, rows: 28, sheetWidth: 800, sheetHeight: 1092 },
  };

  beforeEach(async () => {
    vi.resetModules();

    // Mock Image constructor for loadImage
    const MockImage = class {
      src = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 100;
      height = 100;
      naturalWidth = 100;
      naturalHeight = 100;
      constructor() {
        // Trigger onload async after src is set
        const orig = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'src');
        let _src = '';
        Object.defineProperty(this, 'src', {
          get: () => _src,
          set: (v: string) => {
            _src = v;
            setTimeout(() => this.onload?.(), 0);
          },
        });
      }
    };
    vi.stubGlobal('Image', MockImage);

    // Mock fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('manifest.json')) {
        return {
          ok: true,
          json: async () => MINI_MANIFEST,
        };
      }
      if (url.includes('palette.json') && !url.includes('snow') && !url.includes('interior')) {
        return {
          ok: true,
          json: async () => Array.from({ length: 256 }, () => [0, 0, 0]),
        };
      }
      if (url.includes('remap-colors.json')) {
        return {
          ok: true,
          json: async () => ({
            source: Array.from({ length: 16 }, () => [128, 128, 128]),
            houses: { Spain: Array.from({ length: 16 }, () => [255, 0, 0]) },
          }),
        };
      }
      if (url.includes('tileset.json')) {
        return { ok: false, status: 404 };
      }
      if (url.includes('snow-palette.json') || url.includes('interior-palette.json')) {
        return { ok: false, status: 404 };
      }
      // For PNGs, fetch is not called — Image.src handles them
      return { ok: false, status: 404 };
    }));

    // Also mock document.createElement for getShadowSheet/getRemappedSheet canvas
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag === 'canvas') {
          return {
            width: 0, height: 0,
            getContext: () => ({
              drawImage: vi.fn(),
              getImageData: () => ({ data: new Uint8ClampedArray(0) }),
              putImageData: vi.fn(),
              fillRect: vi.fn(),
              fillStyle: '',
              globalCompositeOperation: 'source-over',
              save: vi.fn(),
              scale: vi.fn(),
              restore: vi.fn(),
            }),
          };
        }
        return {};
      },
    });

    const mod = await import('../engine/assets');
    AssetManager = mod.AssetManager;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loadAll fetches manifest then loads all sprite sheets', async () => {
    const mgr = new AssetManager();
    await mgr.loadAll();
    expect(mgr.isLoaded).toBe(true);
  });

  it('after loadAll, hasSheet returns true for manifest entries', async () => {
    const mgr = new AssetManager();
    await mgr.loadAll();
    expect(mgr.hasSheet('1tnk')).toBe(true);
    expect(mgr.hasSheet('e1')).toBe(true);
  });

  it('after loadAll, getSheet returns SpriteSheet with correct meta', async () => {
    const mgr = new AssetManager();
    await mgr.loadAll();
    const sheet = mgr.getSheet('1tnk');
    expect(sheet).toBeDefined();
    expect(sheet!.meta).toEqual(MINI_MANIFEST['1tnk']);
  });

  it('after loadAll, hasSheet returns false for non-existent sprite', async () => {
    const mgr = new AssetManager();
    await mgr.loadAll();
    expect(mgr.hasSheet('nonexistent')).toBe(false);
  });

  it('after loadAll, getPalette returns the loaded palette', async () => {
    const mgr = new AssetManager();
    await mgr.loadAll();
    const palette = mgr.getPalette();
    expect(palette).not.toBeNull();
    expect(palette!.length).toBe(256);
  });

  it('loadAll calls onProgress callback during loading', async () => {
    const mgr = new AssetManager();
    const progressCalls: [number, number][] = [];
    await mgr.loadAll((loaded, total) => {
      progressCalls.push([loaded, total]);
    });
    // Should have received at least one progress call (one per sprite)
    expect(progressCalls.length).toBeGreaterThan(0);
    // Last call should be (total, total)
    const last = progressCalls[progressCalls.length - 1];
    expect(last[0]).toBe(last[1]);
  });

  it('calling loadAll twice returns immediately the second time', async () => {
    const mgr = new AssetManager();
    await mgr.loadAll();
    expect(mgr.isLoaded).toBe(true);

    // Second call should not re-fetch
    const fetchCount = (globalThis.fetch as any).mock.calls.length;
    const progress: [number, number][] = [];
    await mgr.loadAll((l, t) => progress.push([l, t]));
    expect((globalThis.fetch as any).mock.calls.length).toBe(fetchCount); // no new fetches
    // Progress should report 100% immediately
    expect(progress.length).toBeGreaterThan(0);
    const last = progress[progress.length - 1];
    expect(last[0]).toBe(last[1]);
  });

  it('concurrent loadAll calls share the same promise (no duplicate loads)', async () => {
    const mgr = new AssetManager();
    const p1 = mgr.loadAll();
    const p2 = mgr.loadAll();
    await Promise.all([p1, p2]);
    expect(mgr.isLoaded).toBe(true);
    // manifest.json should have been fetched exactly once
    const manifestFetches = (globalThis.fetch as any).mock.calls.filter(
      (c: string[]) => c[0].includes('manifest.json'),
    );
    expect(manifestFetches.length).toBe(1);
  });

  it('hasRemapData is true after loading remap colors', async () => {
    const mgr = new AssetManager();
    await mgr.loadAll();
    expect(mgr.hasRemapData).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 18. AssetManager.loadAll error handling
// ═══════════════════════════════════════════════════════════════════════════════

describe('AssetManager.loadAll error handling', () => {
  let AssetManager: typeof import('../engine/assets').AssetManager;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('Image', class {
      src = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        Object.defineProperty(this, 'src', {
          set: (v: string) => { setTimeout(() => this.onload?.(), 0); },
          get: () => '',
        });
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('throws when manifest fetch returns non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
    })));
    const mod = await import('../engine/assets');
    AssetManager = mod.AssetManager;
    const mgr = new AssetManager();
    await expect(mgr.loadAll()).rejects.toThrow('Failed to load manifest');
  });

  it('throws when manifest returns null/empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('manifest.json')) {
        return { ok: true, json: async () => null };
      }
      return { ok: false, status: 404 };
    }));
    const mod = await import('../engine/assets');
    AssetManager = mod.AssetManager;
    const mgr = new AssetManager();
    await expect(mgr.loadAll()).rejects.toThrow('Empty manifest');
  });

  it('survives palette fetch failure (optional)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('manifest.json')) {
        return { ok: true, json: async () => ({}) }; // empty manifest = no sprites to load
      }
      // Everything else fails
      return { ok: false, status: 404 };
    }));
    const mod = await import('../engine/assets');
    AssetManager = mod.AssetManager;
    const mgr = new AssetManager();
    // Should not throw — palette/tileset/remap are optional
    await mgr.loadAll();
    expect(mgr.isLoaded).toBe(true);
    expect(mgr.getPalette()).toBeNull();
  });

  it('survives image load failure for sprite sheets', async () => {
    const FailImage = class {
      src = '';
      onload: (() => void) | null = null;
      onerror: ((e: Error) => void) | null = null;
      constructor() {
        Object.defineProperty(this, 'src', {
          set: () => { setTimeout(() => this.onerror?.(new Error('fail')), 0); },
          get: () => '',
        });
      }
    };
    vi.stubGlobal('Image', FailImage);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('manifest.json')) {
        return { ok: true, json: async () => ({ 'bad_sprite': { frameWidth: 1, frameHeight: 1, frameCount: 1, columns: 1, rows: 1, sheetWidth: 1, sheetHeight: 1 } }) };
      }
      if (url.includes('palette.json') || url.includes('remap-colors.json') || url.includes('tileset')) {
        return { ok: false, status: 404 };
      }
      return { ok: false, status: 404 };
    }));
    const mod = await import('../engine/assets');
    AssetManager = mod.AssetManager;
    const mgr = new AssetManager();
    // The image load failure should propagate since it's included in Promise.all
    await expect(mgr.loadAll()).rejects.toThrow('Failed to load image');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 19. Asset URL construction
// ═══════════════════════════════════════════════════════════════════════════════

describe('Asset URL construction', () => {
  // Shared Image mock that triggers onload when src is set (required for tileset loading)
  function makeAutoResolveImage(srcLog?: string[]) {
    return class {
      private _src = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 10;
      height = 10;
      naturalWidth = 10;
      naturalHeight = 10;
      get src() { return this._src; }
      set src(v: string) {
        this._src = v;
        srcLog?.push(v);
        setTimeout(() => this.onload?.(), 0);
      }
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('BASE_URL is /ra/assets as defined in assets.ts', async () => {
    vi.resetModules();
    const calls: string[] = [];
    vi.stubGlobal('Image', makeAutoResolveImage());
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('manifest.json')) {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: false, status: 404 };
    }));
    const mod = await import('../engine/assets');
    const mgr = new mod.AssetManager();
    await mgr.loadAll();
    // Manifest URL should start with /ra/assets/
    const manifestCall = calls.find(c => c.includes('manifest.json'));
    expect(manifestCall).toBeDefined();
    expect(manifestCall).toMatch(/^\/ra\/assets\/manifest\.json/);
  });

  it('sprite PNG URLs use /ra/assets/{name}.png pattern', async () => {
    vi.resetModules();
    const imgSrcs: string[] = [];
    vi.stubGlobal('Image', makeAutoResolveImage(imgSrcs));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('manifest.json')) {
        return { ok: true, json: async () => ({ 'testunit': { frameWidth: 1, frameHeight: 1, frameCount: 1, columns: 1, rows: 1, sheetWidth: 1, sheetHeight: 1 } }) };
      }
      return { ok: false, status: 404 };
    }));
    const mod = await import('../engine/assets');
    const mgr = new mod.AssetManager();
    await mgr.loadAll();
    // Should have loaded testunit.png
    const unitSrc = imgSrcs.find(s => s.includes('testunit.png'));
    expect(unitSrc).toBeDefined();
    expect(unitSrc).toMatch(/^\/ra\/assets\/testunit\.png\?v=/);
  });

  it('cache-bust parameter is appended to all fetch URLs', async () => {
    vi.resetModules();
    const fetchedUrls: string[] = [];
    vi.stubGlobal('Image', makeAutoResolveImage());
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetchedUrls.push(url);
      if (url.includes('manifest.json')) {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: false, status: 404 };
    }));
    const mod = await import('../engine/assets');
    const mgr = new mod.AssetManager();
    await mgr.loadAll();
    // All fetch URLs should have cache-bust ?v=timestamp
    for (const url of fetchedUrls) {
      expect(url, `URL should have cache-bust: ${url}`).toMatch(/\?v=\d+/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 20. Expansion unit sprites present in manifest
// ═══════════════════════════════════════════════════════════════════════════════

describe('Counterstrike/Aftermath expansion unit sprites', () => {
  const EXPANSION_UNITS: [string, string][] = [
    ['STNK', 'stnk'],
    ['CTNK', 'ctnk'],
    ['TTNK', 'ttnk'],
    ['QTNK', 'qtnk'],
    ['DTRK', 'dtrk'],
    ['SHOK', 'shok'],
    ['MSUB', 'msub'],
    ['V2RL', 'v2rl'],
    ['MNLY', 'mnly'],
  ];

  for (const [unitKey, spriteKey] of EXPANSION_UNITS) {
    it(`${unitKey} expansion unit image '${spriteKey}' exists in manifest`, () => {
      expect(manifest[spriteKey], `${spriteKey} missing from manifest`).toBeDefined();
      expect(manifest[spriteKey]?.frameCount).toBeGreaterThan(0);
    });

    it(`${unitKey} UNIT_STATS.image matches '${spriteKey}'`, () => {
      expect(UNIT_STATS[unitKey]?.image).toBe(spriteKey);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 21. Units sharing sprites (GNRL, CHAN, E7, THF → e1; MECH → medi; etc.)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Unit types that share sprites', () => {
  it('GNRL (Stavros) uses e1 sprite', () => {
    expect(UNIT_STATS.GNRL.image).toBe('e1');
  });

  it('CHAN (Specialist) uses e1 sprite', () => {
    expect(UNIT_STATS.CHAN.image).toBe('e1');
  });

  it('E7 (Tanya) uses e1 sprite', () => {
    expect(UNIT_STATS.E7.image).toBe('e1');
  });

  it('THF (Thief) uses e1 sprite', () => {
    expect(UNIT_STATS.THF.image).toBe('e1');
  });

  it('MECH (Mechanic) uses medi sprite', () => {
    expect(UNIT_STATS.MECH.image).toBe('medi');
  });

  it('civilians C1-C10 use either c1 or c2 sprites', () => {
    for (let i = 1; i <= 10; i++) {
      const key = `C${i}`;
      const img = UNIT_STATS[key]?.image;
      expect(img, `${key} should have c1 or c2 image`).toMatch(/^c[12]$/);
      expect(manifest[img!], `${img} missing from manifest`).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 22. Mine sprites (minelayer support)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Mine and crate sprites', () => {
  it('minp (personnel mine) exists in manifest', () => {
    expect(manifest['minp']).toBeDefined();
    expect(manifest['minp']?.frameCount).toBe(1);
    expect(manifest['minp']?.frameWidth).toBe(24);
  });

  it('minv (vehicle mine) exists in manifest', () => {
    expect(manifest['minv']).toBeDefined();
    expect(manifest['minv']?.frameCount).toBe(1);
    expect(manifest['minv']?.frameWidth).toBe(24);
  });

  it('wcrate (crate) exists in manifest', () => {
    expect(manifest['wcrate']).toBeDefined();
    expect(manifest['wcrate']?.frameCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 23. UI overlay sprites
// ═══════════════════════════════════════════════════════════════════════════════

describe('UI overlay and HUD sprites', () => {
  it('select (selection box) has 4 frames', () => {
    expect(manifest['select']?.frameCount).toBe(4);
  });

  it('shadow (unit shadow) has 48 frames', () => {
    expect(manifest['shadow']?.frameCount).toBe(48);
  });

  it('pips (health/cargo pips) has 22 frames', () => {
    expect(manifest['pips']?.frameCount).toBe(22);
  });

  it('powerbar exists with 1 frame', () => {
    expect(manifest['powerbar']?.frameCount).toBe(1);
  });

  it('clock (build timer) has 55 frames', () => {
    expect(manifest['clock']?.frameCount).toBe(55);
  });

  it('repair/sell/map sidebar buttons each have 3 frames', () => {
    for (const btn of ['repair', 'sell', 'map_btn']) {
      expect(manifest[btn]?.frameCount, `${btn}`).toBe(3);
      expect(manifest[btn]?.frameWidth, `${btn}`).toBe(17);
      expect(manifest[btn]?.frameHeight, `${btn}`).toBe(14);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 24. Frame extraction math validation (drawFrameInternal logic)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Frame extraction math (column/row calculation)', () => {
  // Validate the same math used in AssetManager.drawFrameInternal

  it('frame 0 maps to (col=0, row=0) for any sheet', () => {
    const meta = manifest['1tnk'];
    const col = 0 % meta.columns;
    const row = Math.floor(0 / meta.columns);
    expect(col).toBe(0);
    expect(row).toBe(0);
  });

  it('frame 15 maps to (col=15, row=0) for a 16-column sheet', () => {
    const meta = manifest['1tnk']; // columns=16
    const col = 15 % meta.columns;
    const row = Math.floor(15 / meta.columns);
    expect(col).toBe(15);
    expect(row).toBe(0);
  });

  it('frame 16 wraps to (col=0, row=1) for a 16-column sheet', () => {
    const meta = manifest['1tnk'];
    const col = 16 % meta.columns;
    const row = Math.floor(16 / meta.columns);
    expect(col).toBe(0);
    expect(row).toBe(1);
  });

  it('frame 63 (last frame of 1tnk) maps to (col=15, row=3)', () => {
    const meta = manifest['1tnk'];
    const col = 63 % meta.columns;
    const row = Math.floor(63 / meta.columns);
    expect(col).toBe(15);
    expect(row).toBe(3);
    // Source rect
    const sx = col * meta.frameWidth;
    const sy = row * meta.frameHeight;
    expect(sx).toBe(15 * 24);
    expect(sy).toBe(3 * 24);
  });

  it('infantry e1 frame 437 (last frame) correctly maps', () => {
    const meta = manifest['e1']; // 438 frames, columns=16, rows=28
    const idx = 437;
    const col = idx % meta.columns;
    const row = Math.floor(idx / meta.columns);
    expect(col).toBe(437 % 16); // 5
    expect(row).toBe(Math.floor(437 / 16)); // 27
    expect(col).toBe(5);
    expect(row).toBe(27);
    // Fits within sheet
    expect((col + 1) * meta.frameWidth).toBeLessThanOrEqual(meta.sheetWidth);
    expect((row + 1) * meta.frameHeight).toBeLessThanOrEqual(meta.sheetHeight);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 25. Burn/water splash FX sprites
// ═══════════════════════════════════════════════════════════════════════════════

describe('Burn and water splash FX sprites', () => {
  it('burn-s (small burn) has 65 frames at 10x11', () => {
    expect(manifest['burn-s']?.frameCount).toBe(65);
    expect(manifest['burn-s']?.frameWidth).toBe(10);
    expect(manifest['burn-s']?.frameHeight).toBe(11);
  });

  it('burn-m (medium burn) has 67 frames at 14x14', () => {
    expect(manifest['burn-m']?.frameCount).toBe(67);
    expect(manifest['burn-m']?.frameWidth).toBe(14);
  });

  it('burn-l (large burn) has 67 frames at 23x23', () => {
    expect(manifest['burn-l']?.frameCount).toBe(67);
    expect(manifest['burn-l']?.frameWidth).toBe(23);
  });

  it('h2o_exp1/exp2/exp3 water explosions each have 10 frames', () => {
    expect(manifest['h2o_exp1']?.frameCount).toBe(10);
    expect(manifest['h2o_exp2']?.frameCount).toBe(10);
    expect(manifest['h2o_exp3']?.frameCount).toBe(10);
  });

  it('wake (vessel wake) has 12 frames', () => {
    expect(manifest['wake']?.frameCount).toBe(12);
  });
});
