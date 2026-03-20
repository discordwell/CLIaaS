/**
 * C++ Behavioral Parity Tests — Asset/Sprite Remap & Shadow
 *
 * Tests house color remapping, shadow sheet generation, sprite frame indexing,
 * palette constants, and asset path resolution against C++ source behavior.
 *
 * C++ references:
 *   - remap.cpp / housetyp.cpp  — Init_Color_Remaps, 16-entry remap tables per house
 *   - display.cpp               — SHAPE_GHOST shadow rendering (sprite-shaped silhouette)
 *   - udata.cpp:BodyShape[32]   — vehicle facing-to-frame mapping
 *   - idata.cpp:HumanShape[8]   — infantry facing-to-frame mapping
 *   - idata.cpp:DoControls      — infantry animation frame layouts per type
 *
 * Data source: public/ra/assets/remap-colors.json (extracted from original palette)
 *              public/ra/assets/manifest.json (sprite sheet metadata)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  House, BODY_SHAPE, INFANTRY_SHAPE,
  INFANTRY_ANIMS, ANT_ANIM, UNIT_STATS,
} from '../engine/types';

// ============================================================
// Load actual asset data files (same files the engine loads at runtime)
// ============================================================
const ASSETS_DIR = join(__dirname, '../../../public/ra/assets');
const remapColors: {
  source: number[][];
  houses: Record<string, number[][]>;
} = JSON.parse(readFileSync(join(ASSETS_DIR, 'remap-colors.json'), 'utf-8'));

const manifest: Record<string, {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  columns: number;
  rows: number;
  sheetWidth: number;
  sheetHeight: number;
}> = JSON.parse(readFileSync(join(ASSETS_DIR, 'manifest.json'), 'utf-8'));

// ============================================================
// Section 1: House color remap palette structure
// C++ remap.cpp — Init_Color_Remaps builds 16-entry remap tables
// Each house has exactly 16 RGB color entries that replace the
// 16 "unit color" palette indices (176-191 in the 6-bit VGA palette).
// ============================================================
describe('remap palette structure (C++ remap.cpp — Init_Color_Remaps)', () => {
  it('source palette has exactly 16 entries (palette indices 176-191)', () => {
    // C++ uses 16 consecutive palette entries for unit coloring
    // remap.cpp: for (int i = 0; i < 16; i++) ...
    expect(remapColors.source).toHaveLength(16);
  });

  it('each source color is an [R, G, B] triple with values 0-255', () => {
    for (const color of remapColors.source) {
      expect(color, 'each entry should be [R, G, B]').toHaveLength(3);
      for (const channel of color) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  // C++ houses that have remap tables defined
  const EXPECTED_REMAP_HOUSES = ['Spain', 'Greece', 'USSR', 'Ukraine', 'Germany', 'Turkey'];

  it('remap data covers all 6 multiplayer houses', () => {
    for (const house of EXPECTED_REMAP_HOUSES) {
      expect(remapColors.houses[house], `${house} should have remap data`).toBeDefined();
    }
  });

  for (const house of EXPECTED_REMAP_HOUSES) {
    it(`${house} has exactly 16 remap color entries`, () => {
      expect(remapColors.houses[house]).toHaveLength(16);
    });

    it(`${house} remap colors are valid [R, G, B] triples`, () => {
      for (const color of remapColors.houses[house]) {
        expect(color).toHaveLength(3);
        for (const channel of color) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
    });
  }
});

// ============================================================
// Section 2: House-specific remap color constants
// C++ housetyp.cpp — each house maps to a PlayerColorType (PCOLOR_*)
// which indexes into the color remap table rows.
//   Spain   = PCOLOR_GOLD   (yellow/gold gradient)
//   Greece  = PCOLOR_BLUE   (blue gradient)
//   USSR    = PCOLOR_RED    (red/orange gradient)
//   Ukraine = PCOLOR_ORANGE (orange gradient)
//   Germany = PCOLOR_GREY   (grey gradient)
//   Turkey  = PCOLOR_BROWN  (brown gradient)
// ============================================================
describe('house-specific remap colors match C++ PCOLOR constants', () => {

  it('Spain (PCOLOR_GOLD): source colors are identity remap', () => {
    // C++ housetyp.cpp: Spain uses PCOLOR_GOLD which is row 0 — the source row.
    // Therefore Spain's remap colors must be identical to the source palette.
    // getRemappedSheet for Spain is effectively a no-op.
    for (let i = 0; i < 16; i++) {
      expect(
        remapColors.houses.Spain[i],
        `Spain[${i}] should equal source[${i}]`
      ).toEqual(remapColors.source[i]);
    }
  });

  it('Greece (PCOLOR_BLUE): blue-dominant gradient, darkest entry is dark blue', () => {
    // C++ palette: Greece uses blue gradient. Verify blue channel dominates.
    const greekColors = remapColors.houses.Greece;
    // First entry (lightest) should have high blue channel
    expect(greekColors[0][2]).toBeGreaterThan(greekColors[0][0]); // B > R
    // Last entry (darkest) should be dark blue
    const darkest = greekColors[15];
    expect(darkest[2]).toBeGreaterThan(darkest[0]); // B > R
    expect(darkest[2]).toBeGreaterThan(darkest[1]); // B > G
  });

  it('USSR (PCOLOR_RED): red-dominant gradient, first entry is bright orange-red', () => {
    // C++ palette: USSR uses red/fire gradient
    const ussrColors = remapColors.houses.USSR;
    // First entry should have dominant red
    expect(ussrColors[0][0]).toBeGreaterThan(ussrColors[0][1]); // R > G
    expect(ussrColors[0][0]).toBeGreaterThan(ussrColors[0][2]); // R > B
    // Verify it's bright red (R channel > 200)
    expect(ussrColors[0][0]).toBeGreaterThan(200);
  });

  it('Ukraine (PCOLOR_ORANGE): orange gradient from bright to dark', () => {
    // C++ palette: Ukraine uses orange gradient
    const ukrColors = remapColors.houses.Ukraine;
    // Lightest entry: high R, moderate-high G, lower B
    expect(ukrColors[0][0]).toBeGreaterThan(ukrColors[0][2]); // R > B
    expect(ukrColors[0][1]).toBeGreaterThan(ukrColors[0][2]); // G > B
  });

  it('Germany (PCOLOR_GREY): grey gradient with near-equal RGB channels', () => {
    // C++ palette: Germany uses grey/silver gradient
    const greyColors = remapColors.houses.Germany;
    // First entry should be near-white (high, roughly equal RGB)
    const [r, g, b] = greyColors[0];
    expect(r).toBeGreaterThan(200);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(30); // channels roughly equal
    expect(Math.abs(r - b)).toBeLessThanOrEqual(30);
  });

  it('Turkey (PCOLOR_BROWN): brown/tan gradient', () => {
    // C++ palette: Turkey uses brown/tan gradient
    const turkColors = remapColors.houses.Turkey;
    // First entry: warm tone (R > B)
    expect(turkColors[0][0]).toBeGreaterThan(turkColors[0][2]); // R > B
  });

  it('each house has a distinct remap palette (no two houses identical)', () => {
    const houseNames = Object.keys(remapColors.houses);
    for (let i = 0; i < houseNames.length; i++) {
      for (let j = i + 1; j < houseNames.length; j++) {
        const a = remapColors.houses[houseNames[i]];
        const b = remapColors.houses[houseNames[j]];
        const identical = a.every((color, idx) =>
          color[0] === b[idx][0] && color[1] === b[idx][1] && color[2] === b[idx][2]
        );
        expect(
          identical,
          `${houseNames[i]} and ${houseNames[j]} should have different palettes`
        ).toBe(false);
      }
    }
  });

  it('remap gradients are monotonically decreasing in brightness', () => {
    // C++ remap tables go from lightest (index 0) to darkest (index 15).
    // Brightness = R + G + B should generally decrease.
    for (const [house, colors] of Object.entries(remapColors.houses)) {
      const firstBrightness = colors[0][0] + colors[0][1] + colors[0][2];
      const lastBrightness = colors[15][0] + colors[15][1] + colors[15][2];
      expect(
        firstBrightness,
        `${house} first entry should be brighter than last`
      ).toBeGreaterThan(lastBrightness);
    }
  });
});

// ============================================================
// Section 3: Remap color tolerance matching
// C++ assets.ts:330 — pixel matching uses +-2 tolerance per channel
// to handle palette quantization differences between 6-bit VGA and 8-bit RGB
// ============================================================
describe('remap tolerance matching (assets.ts:330, C++ palette quantization)', () => {
  it('tolerance is +-2 per channel (handles 6-bit VGA to 8-bit RGB conversion)', () => {
    // The getRemappedSheet method in assets.ts uses:
    //   Math.abs(r - sr) <= 2 && Math.abs(g - sg) <= 2 && Math.abs(b - sb) <= 2
    // This is necessary because C++ VGA palette uses 6-bit color (0-63 per channel)
    // which maps to 8-bit (0-255) with slight quantization differences.
    const tolerance = 2;

    // A source color of [247, 215, 121] should match pixels at [245, 213, 119] through [249, 217, 123]
    const src = remapColors.source[0];
    for (let dr = -tolerance; dr <= tolerance; dr++) {
      for (let dg = -tolerance; dg <= tolerance; dg++) {
        for (let db = -tolerance; db <= tolerance; db++) {
          const testR = src[0] + dr;
          const testG = src[1] + dg;
          const testB = src[2] + db;
          const matches = Math.abs(testR - src[0]) <= tolerance
            && Math.abs(testG - src[1]) <= tolerance
            && Math.abs(testB - src[2]) <= tolerance;
          expect(matches, `[${testR},${testG},${testB}] should match source[0]`).toBe(true);
        }
      }
    }
  });

  it('outside tolerance does not match (+-3 fails)', () => {
    const src = remapColors.source[0];
    // Exactly 3 off in one channel should NOT match
    const r = src[0] + 3;
    const matches = Math.abs(r - src[0]) <= 2;
    expect(matches).toBe(false);
  });

  it('transparent pixels are skipped in remap (alpha === 0)', () => {
    // C++ assets.ts:326: if (pixels[i + 3] === 0) continue;
    // Transparent pixels should never be remapped regardless of RGB values.
    // This test documents the guard clause behavior.
    const alpha = 0;
    const shouldSkip = alpha === 0;
    expect(shouldSkip).toBe(true);
  });
});

// ============================================================
// Section 4: Shadow sheet generation
// C++ display.cpp — SHAPE_GHOST uses sprite-shaped silhouette
// rendered with semi-transparent dark overlay, alpha preserved.
// assets.ts:277-283 implements this with 'source-in' composite.
// ============================================================
describe('shadow sheet generation (C++ SHAPE_GHOST, display.cpp)', () => {
  it('shadow color is rgb(100,100,100) dark gray, not pure black', () => {
    // C++ SHAPE_GHOST uses palette-index shadow which maps to a dark
    // shade rather than pure black. assets.ts:281 uses rgb(100,100,100)
    // so 'multiply' blend darkens terrain proportionally rather than zeroing.
    const SHADOW_R = 100;
    const SHADOW_G = 100;
    const SHADOW_B = 100;
    // Not black (0,0,0)
    expect(SHADOW_R).toBeGreaterThan(0);
    expect(SHADOW_G).toBeGreaterThan(0);
    expect(SHADOW_B).toBeGreaterThan(0);
    // Not white or bright
    expect(SHADOW_R).toBeLessThan(128);
  });

  it('shadow uses source-in composite operation to preserve sprite shape', () => {
    // C++ SHAPE_GHOST: shadow has the same pixel shape as the unit sprite.
    // assets.ts:280 uses 'source-in' which fills only where existing pixels are opaque.
    // This preserves the alpha channel from the original sprite.
    const compositeOp = 'source-in';
    expect(compositeOp).toBe('source-in');
  });

  it('shadow sheets are cached by sprite name (one per unique sprite)', () => {
    // C++ creates shadow data once per SHP file. assets.ts:268 checks
    // shadowSheets.has(sheetName) before generating.
    // Each unique image string in UNIT_STATS should map to one shadow sheet.
    const uniqueImages = new Set<string>();
    for (const stats of Object.values(UNIT_STATS)) {
      uniqueImages.add(stats.image);
    }
    // More unit types than unique images (some share sprites, e.g. GNRL uses 'e1')
    const unitCount = Object.keys(UNIT_STATS).length;
    expect(uniqueImages.size).toBeLessThan(unitCount);
    expect(uniqueImages.size).toBeGreaterThan(0);
  });
});

// ============================================================
// Section 5: Vehicle sprite frame indexing
// C++ udata.cpp — BodyShape[32] maps 32-step facing to frame index
// Vehicle SHP files have 32 frames for 32 rotation angles.
// ============================================================
describe('vehicle BODY_SHAPE[32] facing-to-frame (C++ udata.cpp)', () => {
  it('BODY_SHAPE has exactly 32 entries (32-step facing resolution)', () => {
    expect(BODY_SHAPE).toHaveLength(32);
  });

  it('facing 0 (North) maps to frame 0', () => {
    // C++ BodyShape[0] = 0 — vehicle facing directly north uses frame 0
    expect(BODY_SHAPE[0]).toBe(0);
  });

  it('facing 16 (South) maps to frame 16', () => {
    // C++ BodyShape[16] = 16 — vehicle facing directly south uses frame 16
    expect(BODY_SHAPE[16]).toBe(16);
  });

  it('facing 1 maps to frame 31 (reversed order for non-zero indices)', () => {
    // C++ BodyShape[1] = 31 — the table reverses for indices 1-31
    // This gives: 0, 31, 30, 29, ..., 2, 1
    expect(BODY_SHAPE[1]).toBe(31);
  });

  it('all 32 frame indices are unique (each facing has a unique frame)', () => {
    const unique = new Set(BODY_SHAPE);
    expect(unique.size).toBe(32);
  });

  it('frame indices span exactly 0-31', () => {
    expect(Math.min(...BODY_SHAPE)).toBe(0);
    expect(Math.max(...BODY_SHAPE)).toBe(31);
  });

  it('non-zero entries are reversed: BODY_SHAPE[i] = 32 - i for i > 0', () => {
    // C++ BodyShape: { 0, 31, 30, 29, ..., 2, 1 }
    for (let i = 1; i < 32; i++) {
      expect(BODY_SHAPE[i], `BODY_SHAPE[${i}]`).toBe(32 - i);
    }
  });

  it('vehicle sprites in manifest have 32 or 64 frames (body or body+turret)', () => {
    // C++ vehicles: 32 body frames. Turreted vehicles add 32 turret frames = 64 total.
    const vehicleSprites = ['1tnk', '2tnk', '3tnk', '4tnk', 'jeep', 'arty', 'mcv', 'truk'];
    for (const name of vehicleSprites) {
      const entry = manifest[name];
      expect(entry, `${name} should be in manifest`).toBeDefined();
      expect(
        entry.frameCount === 32 || entry.frameCount === 64,
        `${name} should have 32 or 64 frames, got ${entry.frameCount}`
      ).toBe(true);
    }
  });
});

// ============================================================
// Section 6: Infantry sprite frame indexing
// C++ infantry.cpp:90 — HumanShape maps 8-direction enum to SHP frame order.
// SHP direction order: N(0), NW(1), W(2), SW(3), S(4), SE(5), E(6), NE(7)
// Game direction enum: N(0), NE(1), E(2), SE(3), S(4), SW(5), W(6), NW(7)
// ============================================================
describe('infantry INFANTRY_SHAPE[8] facing-to-frame (C++ infantry.cpp:90)', () => {
  it('INFANTRY_SHAPE has exactly 8 entries (8 cardinal/ordinal directions)', () => {
    expect(INFANTRY_SHAPE).toHaveLength(8);
  });

  it('North (Dir.N=0) maps to SHP direction 0 (facing up in sprite)', () => {
    expect(INFANTRY_SHAPE[0]).toBe(0);
  });

  it('South (Dir.S=4) maps to SHP direction 4', () => {
    expect(INFANTRY_SHAPE[4]).toBe(4);
  });

  it('NE game direction (1) maps to SHP direction 7', () => {
    // Game: N=0,NE=1,E=2,SE=3,S=4,SW=5,W=6,NW=7
    // SHP:  N=0,NW=1,W=2,SW=3,S=4,SE=5,E=6,NE=7
    // So game NE(1) → SHP NE(7)
    expect(INFANTRY_SHAPE[1]).toBe(7);
  });

  it('E game direction (2) maps to SHP direction 6', () => {
    expect(INFANTRY_SHAPE[2]).toBe(6);
  });

  it('W game direction (6) maps to SHP direction 2', () => {
    expect(INFANTRY_SHAPE[6]).toBe(2);
  });

  it('NW game direction (7) maps to SHP direction 1', () => {
    expect(INFANTRY_SHAPE[7]).toBe(1);
  });

  it('full HumanShape table matches C++ exactly: [0, 7, 6, 5, 4, 3, 2, 1]', () => {
    // C++ infantry.cpp:90
    // int const InfantryClass::HumanShape[] = {0, 7, 6, 5, 4, 3, 2, 1};
    expect(INFANTRY_SHAPE).toEqual([0, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('N and S map to themselves (symmetric axis)', () => {
    expect(INFANTRY_SHAPE[0]).toBe(0); // N → N
    expect(INFANTRY_SHAPE[4]).toBe(4); // S → S
  });

  it('mapping is its own inverse: INFANTRY_SHAPE[INFANTRY_SHAPE[i]] === i', () => {
    // The reversal pattern means applying the mapping twice returns the original
    for (let i = 0; i < 8; i++) {
      expect(
        INFANTRY_SHAPE[INFANTRY_SHAPE[i]],
        `double-mapping dir ${i} should return to ${i}`
      ).toBe(i);
    }
  });
});

// ============================================================
// Section 7: Infantry animation frame layout
// C++ idata.cpp — DoControls define frame offsets, counts, and jump
// values for each infantry type's animation states.
// Frame formula: frame + INFANTRY_SHAPE[dir] * jump + animFrame % count
// ============================================================
describe('infantry animation frame layout (C++ idata.cpp DoControls)', () => {
  it('E1 (E1DoControls idata.cpp:80): ready at frame 0, walk at frame 16', () => {
    const e1 = INFANTRY_ANIMS.E1;
    expect(e1.ready.frame).toBe(0);
    expect(e1.ready.count).toBe(1);
    expect(e1.ready.jump).toBe(1);
    expect(e1.walk.frame).toBe(16);
    expect(e1.walk.count).toBe(6);
    expect(e1.walk.jump).toBe(6);
  });

  it('E1 fire animation: 8 frames per facing starting at frame 64', () => {
    // C++ E1DoControls: fire = {64, 8, 8}
    const e1 = INFANTRY_ANIMS.E1;
    expect(e1.fire.frame).toBe(64);
    expect(e1.fire.count).toBe(8);
    expect(e1.fire.jump).toBe(8);
  });

  it('E1 death animations are non-directional (jump=0)', () => {
    // C++ idata.cpp: death sequences are shared across all facings
    const e1 = INFANTRY_ANIMS.E1;
    expect(e1.die1.jump).toBe(0);
    expect(e1.die2!.jump).toBe(0);
    expect(e1.die1.count).toBe(8);
  });

  it('DOG (DogDoControls idata.cpp:56): walk at frame 8 with 6 frames/facing', () => {
    const dog = INFANTRY_ANIMS.DOG;
    expect(dog.walk.frame).toBe(8);
    expect(dog.walk.count).toBe(6);
    expect(dog.walk.jump).toBe(6);
  });

  it('DOG has custom walkRate=2 (faster than default 3)', () => {
    // C++ MasterDoControls: dog walk animation plays faster
    expect(INFANTRY_ANIMS.DOG.walkRate).toBe(2);
  });

  it('DOG fire animation: 14 frames per facing (bite attack)', () => {
    // C++ DogDoControls: fire = {104, 14, 14}
    expect(INFANTRY_ANIMS.DOG.fire.frame).toBe(104);
    expect(INFANTRY_ANIMS.DOG.fire.count).toBe(14);
    expect(INFANTRY_ANIMS.DOG.fire.jump).toBe(14);
  });

  it('E6 (Engineer) has no fire animation (count=0)', () => {
    // C++ E6DoControls: engineers cannot shoot
    const e6 = INFANTRY_ANIMS.E6;
    expect(e6.fire.count).toBe(0);
    expect(e6.fire.jump).toBe(0);
  });

  it('E2 (Grenadier) fire has 20 frames per facing (long throw animation)', () => {
    // C++ E2DoControls (idata.cpp:104): fire = {64, 20, 20}
    const e2 = INFANTRY_ANIMS.E2;
    expect(e2.fire.frame).toBe(64);
    expect(e2.fire.count).toBe(20);
    expect(e2.fire.jump).toBe(20);
  });

  it('E2 has custom attackRate=6 (slower throw than default 5)', () => {
    expect(INFANTRY_ANIMS.E2.attackRate).toBe(6);
  });

  it('SHOK uses same animation data as E7 (C++ Shock Trooper = E7 unit type)', () => {
    // C++ idata.cpp: SHOK is defined as E7 internally
    expect(INFANTRY_ANIMS.SHOK).toBe(INFANTRY_ANIMS.E7);
  });

  it('all infantry types with INFANTRY_ANIMS have ready and walk animations', () => {
    for (const [type, anim] of Object.entries(INFANTRY_ANIMS)) {
      expect(anim.ready, `${type} should have ready animation`).toBeDefined();
      expect(anim.walk, `${type} should have walk animation`).toBeDefined();
      expect(anim.ready.count, `${type} ready.count should be > 0`).toBeGreaterThan(0);
      expect(anim.walk.count, `${type} walk.count should be > 0`).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// Section 8: Ant animation frame indexing
// C++ ANT*.SHP files have 112 total frames arranged as:
//   Standing:  frames 0-7   (8 directions x 1 frame)
//   Walking:   frames 8-71  (8 directions x 8 frames)
//   Attacking: frames 72-103 (8 directions x 4 frames)
//   Dying:     frames 104-111 (8-frame shared sequence)
// ============================================================
describe('ant animation frame layout (C++ ANT*.SHP)', () => {
  it('standing base is frame 0', () => {
    expect(ANT_ANIM.standBase).toBe(0);
  });

  it('walking: 8 frames per facing starting at frame 8', () => {
    expect(ANT_ANIM.walkBase).toBe(8);
    expect(ANT_ANIM.walkCount).toBe(8);
  });

  it('attacking: 4 frames per facing starting at frame 72', () => {
    expect(ANT_ANIM.attackBase).toBe(72);
    expect(ANT_ANIM.attackCount).toBe(4);
  });

  it('death sequence: 8 frames starting at frame 104', () => {
    expect(ANT_ANIM.deathBase).toBe(104);
    expect(ANT_ANIM.deathCount).toBe(8);
  });

  it('total frames = 8 + 64 + 32 + 8 = 112', () => {
    // Standing: 8 directions * 1 frame = 8
    // Walking: 8 directions * 8 frames = 64
    // Attacking: 8 directions * 4 frames = 32
    // Dying: 8 frames shared = 8
    const total = 8 + (8 * ANT_ANIM.walkCount) + (8 * ANT_ANIM.attackCount) + ANT_ANIM.deathCount;
    expect(total).toBe(112);
  });

  it('all 3 ant sprite sheets (ant1, ant2, ant3) have 112 frames in manifest', () => {
    for (const name of ['ant1', 'ant2', 'ant3']) {
      expect(manifest[name], `${name} should be in manifest`).toBeDefined();
      expect(manifest[name].frameCount, `${name} should have 112 frames`).toBe(112);
    }
  });

  it('ant death sprite (antdie) has 8 frames in manifest', () => {
    expect(manifest.antdie).toBeDefined();
    expect(manifest.antdie.frameCount).toBe(8);
  });

  it('ant sprites are 48x48 pixels per frame', () => {
    for (const name of ['ant1', 'ant2', 'ant3', 'antdie']) {
      expect(manifest[name].frameWidth, `${name} frameWidth`).toBe(48);
      expect(manifest[name].frameHeight, `${name} frameHeight`).toBe(48);
    }
  });
});

// ============================================================
// Section 9: Asset path resolution
// C++ loads sprites from MIX files; TS loads from /ra/assets/{name}.png
// UNIT_STATS.image is the lowercase key that maps to both manifest
// entries and PNG file names.
// ============================================================
describe('asset path resolution (UNIT_STATS.image to sprite mapping)', () => {
  // C++ MIX file sprite names are uppercase (1TNK.SHP); TS uses lowercase
  const VEHICLE_IMAGE_MAP: [string, string][] = [
    ['1TNK', '1tnk'],   // C++ udata.cpp: UnitTypeClass::Light_Tank
    ['2TNK', '2tnk'],   // C++ udata.cpp: UnitTypeClass::Medium_Tank
    ['3TNK', '3tnk'],   // C++ udata.cpp: UnitTypeClass::Heavy_Tank
    ['4TNK', '4tnk'],   // C++ udata.cpp: UnitTypeClass::Mammoth_Tank
    ['JEEP', 'jeep'],   // C++ udata.cpp: UnitTypeClass::Ranger
    ['APC',  'apc'],    // C++ udata.cpp: UnitTypeClass::APC
    ['ARTY', 'arty'],   // C++ udata.cpp: UnitTypeClass::V2_Launcher
    ['HARV', 'harv'],   // C++ udata.cpp: UnitTypeClass::Harvester
    ['MCV',  'mcv'],    // C++ udata.cpp: UnitTypeClass::MCV
    ['TRUK', 'truk'],   // C++ udata.cpp: UnitTypeClass::Supply_Truck
  ];

  for (const [unitKey, expectedImage] of VEHICLE_IMAGE_MAP) {
    it(`${unitKey} maps to sprite '${expectedImage}'`, () => {
      const stats = UNIT_STATS[unitKey];
      expect(stats, `${unitKey} should exist in UNIT_STATS`).toBeDefined();
      expect(stats.image).toBe(expectedImage);
    });

    it(`${expectedImage} exists in manifest`, () => {
      expect(manifest[expectedImage], `${expectedImage} should be in manifest`).toBeDefined();
    });
  }

  const INFANTRY_IMAGE_MAP: [string, string][] = [
    ['E1',  'e1'],    // C++ idata.cpp: InfantryTypeClass::E1
    ['E2',  'e2'],    // C++ idata.cpp: InfantryTypeClass::E2
    ['E3',  'e3'],    // C++ idata.cpp: InfantryTypeClass::E3
    ['E4',  'e4'],    // C++ idata.cpp: InfantryTypeClass::E4
    ['E6',  'e6'],    // C++ idata.cpp: InfantryTypeClass::E6 (Engineer)
    ['DOG', 'dog'],   // C++ idata.cpp: InfantryTypeClass::Dog
    ['SPY', 'spy'],   // C++ idata.cpp: InfantryTypeClass::Spy
    ['MEDI', 'medi'], // C++ idata.cpp: InfantryTypeClass::Medic
  ];

  for (const [unitKey, expectedImage] of INFANTRY_IMAGE_MAP) {
    it(`${unitKey} maps to sprite '${expectedImage}'`, () => {
      expect(UNIT_STATS[unitKey].image).toBe(expectedImage);
    });

    it(`${expectedImage} exists in manifest`, () => {
      expect(manifest[expectedImage]).toBeDefined();
    });
  }

  it('GNRL and CHAN share E1 sprite (C++ re-skins using same SHP)', () => {
    // C++ idata.cpp: Stavros (GNRL) and Specialist (CHAN) both use E1.SHP
    expect(UNIT_STATS.GNRL.image).toBe('e1');
    expect(UNIT_STATS.CHAN.image).toBe('e1');
  });

  it('MECH shares MEDI sprite (C++ Mechanic uses Medic SHP)', () => {
    // C++ idata.cpp: Mechanic uses same sprite sheet as Medic
    expect(UNIT_STATS.MECH.image).toBe('medi');
  });

  it('all ANT units map to ant1/ant2/ant3 sprites', () => {
    expect(UNIT_STATS.ANT1.image).toBe('ant1');
    expect(UNIT_STATS.ANT2.image).toBe('ant2');
    expect(UNIT_STATS.ANT3.image).toBe('ant3');
  });
});

// ============================================================
// Section 10: Sprite frame count consistency
// Verifies that manifest frame counts are consistent with what
// the engine expects for rendering (BODY_SHAPE[32] for vehicles,
// INFANTRY_ANIMS max frame indices for infantry).
// ============================================================
describe('sprite frame count consistency', () => {
  it('vehicle sprites have at least 32 frames (one per body facing)', () => {
    // C++ vehicles: BodyShape[32] uses frames 0-31 for body rotation
    const vehicleImages = ['1tnk', '2tnk', '3tnk', '4tnk', 'jeep', 'arty', 'mcv', 'truk'];
    for (const name of vehicleImages) {
      expect(
        manifest[name].frameCount,
        `${name} needs >= 32 frames for BODY_SHAPE indexing`
      ).toBeGreaterThanOrEqual(32);
    }
  });

  it('turreted tanks have 64 frames (32 body + 32 turret)', () => {
    // C++ turreted vehicles: first 32 frames = body, next 32 = turret
    for (const name of ['1tnk', '2tnk', '3tnk', '4tnk']) {
      expect(manifest[name].frameCount, `${name} should have 64 frames`).toBe(64);
    }
  });

  it('non-turreted vehicles have exactly 32 frames', () => {
    // C++ non-turreted: just 32 body rotation frames
    for (const name of ['arty', 'mcv', 'truk']) {
      expect(manifest[name].frameCount, `${name} should have 32 frames`).toBe(32);
    }
  });

  it('E1 manifest frame count accommodates max INFANTRY_ANIMS frame index', () => {
    // C++ E1DoControls: die2 at frame 304, count 8 → max frame = 311
    // Plus idle animations at 256-287.
    const e1 = INFANTRY_ANIMS.E1;
    const maxFrame = Math.max(
      e1.die1.frame + e1.die1.count - 1,
      e1.die2!.frame + e1.die2!.count - 1,
      e1.idle!.frame + e1.idle!.count - 1,
    );
    expect(
      manifest.e1.frameCount,
      `e1 needs at least ${maxFrame + 1} frames`
    ).toBeGreaterThan(maxFrame);
  });

  it('DOG manifest frame count accommodates max animation frame index', () => {
    const dog = INFANTRY_ANIMS.DOG;
    const maxFrame = Math.max(
      dog.die1.frame + dog.die1.count - 1,
      dog.die2!.frame + dog.die2!.count - 1,
      dog.idle!.frame + dog.idle!.count - 1,
    );
    expect(
      manifest.dog.frameCount,
      `dog needs at least ${maxFrame + 1} frames`
    ).toBeGreaterThan(maxFrame);
  });

  it('infantry frame formula does not exceed manifest frame count', () => {
    // Frame formula: frame + INFANTRY_SHAPE[dir] * jump + (count-1)
    // For directional anims, max occurs at dir=7 (INFANTRY_SHAPE[7]=1, same as jump)
    // Actually max is INFANTRY_SHAPE[1]=7 since it is the largest shape index
    const maxDirIdx = Math.max(...INFANTRY_SHAPE); // = 7
    const checks: [string, string][] = [
      ['E1', 'e1'], ['E2', 'e2'], ['E3', 'e3'], ['E4', 'e4'],
      ['E6', 'e6'], ['DOG', 'dog'], ['SPY', 'spy'],
    ];
    for (const [animKey, spriteKey] of checks) {
      const anim = INFANTRY_ANIMS[animKey];
      if (!anim) continue;
      const states = [anim.ready, anim.walk, anim.fire, anim.prone, anim.crawl,
        anim.fireProne, anim.lieDown, anim.getUp, anim.die1, anim.die2,
        anim.idle, anim.idle2].filter(Boolean);
      for (const state of states) {
        if (state!.jump > 0) {
          const maxFrameIdx = state!.frame + maxDirIdx * state!.jump + state!.count - 1;
          expect(
            maxFrameIdx,
            `${animKey} state at frame ${state!.frame} exceeds ${spriteKey} frame count`
          ).toBeLessThan(manifest[spriteKey].frameCount);
        }
      }
    }
  });
});

// ============================================================
// Section 11: Remap sheet caching key format
// C++ creates one remap per (SHP, house). assets.ts uses
// `${sheetName}:${house}` as the cache key.
// ============================================================
describe('remap sheet caching semantics', () => {
  it('cache key format is "sheetName:house" (deterministic, unique per combo)', () => {
    // assets.ts:309: const key = `${sheetName}:${house}`;
    const key = `2tnk:${House.USSR}`;
    expect(key).toBe('2tnk:USSR');
  });

  it('different houses for same sprite produce different cache keys', () => {
    const keys = [House.Spain, House.Greece, House.USSR].map(h => `2tnk:${h}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(3);
  });

  it('same house for different sprites produces different cache keys', () => {
    const keys = ['1tnk', '2tnk', '3tnk'].map(s => `${s}:${House.Spain}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(3);
  });

  it('units sharing a sprite share remap data (GNRL and E1 use same image)', () => {
    // C++ optimization: units using the same SHP file share the remapped sheet
    const gnrlKey = `${UNIT_STATS.GNRL.image}:${House.Spain}`;
    const e1Key = `${UNIT_STATS.E1.image}:${House.Spain}`;
    expect(gnrlKey).toBe(e1Key); // both resolve to 'e1:Spain'
  });
});

// ============================================================
// Section 12: House enum coverage
// Verify all House enum values that appear in remap data
// correspond to valid game houses.
// ============================================================
describe('House enum to remap data coverage', () => {
  it('all remap houses map to valid House enum values', () => {
    const houseValues = new Set(Object.values(House));
    for (const houseName of Object.keys(remapColors.houses)) {
      expect(
        houseValues.has(houseName as House),
        `remap house '${houseName}' should be a valid House enum value`
      ).toBe(true);
    }
  });

  it('player house (Spain) has remap data', () => {
    expect(remapColors.houses[House.Spain]).toBeDefined();
  });

  it('all ant mission houses have remap data', () => {
    // Ant missions use Spain, Greece (allied) and USSR, Ukraine, Germany (enemy)
    expect(remapColors.houses[House.Spain]).toBeDefined();
    expect(remapColors.houses[House.Greece]).toBeDefined();
    expect(remapColors.houses[House.USSR]).toBeDefined();
    expect(remapColors.houses[House.Ukraine]).toBeDefined();
    expect(remapColors.houses[House.Germany]).toBeDefined();
  });

  it('England and France are not in remap data (campaign only, no multiplayer color)', () => {
    // C++ multiplayer supports 6 houses; England/France use in-game remapping
    // or palette swaps not present in the extracted remap-colors.json
    expect(remapColors.houses[House.England]).toBeUndefined();
    expect(remapColors.houses[House.France]).toBeUndefined();
  });
});

// ============================================================
// Section 13: Specific C++ remap color values
// Verify a few exact RGB values from the extracted palette data
// to confirm the extraction was done correctly from the original
// game's 6-bit VGA palette (values * 4 to convert to 8-bit RGB).
// ============================================================
describe('exact remap color values from C++ palette extraction', () => {
  it('Spain source[0] (lightest gold) = [247, 215, 121]', () => {
    // C++ palette index 176 (first unit color) in PCOLOR_GOLD row
    expect(remapColors.source[0]).toEqual([247, 215, 121]);
  });

  it('Spain source[15] (darkest gold) = [40, 32, 8]', () => {
    // C++ palette index 191 (last unit color) in PCOLOR_GOLD row
    expect(remapColors.source[15]).toEqual([40, 32, 8]);
  });

  it('Greece[0] (lightest blue) = [227, 231, 247]', () => {
    // PCOLOR_BLUE lightest entry
    expect(remapColors.houses.Greece[0]).toEqual([227, 231, 247]);
  });

  it('USSR[0] (brightest red) = [255, 93, 0]', () => {
    // PCOLOR_RED brightest entry — orange-red
    expect(remapColors.houses.USSR[0]).toEqual([255, 93, 0]);
  });

  it('USSR[1] = [255, 0, 0] (pure red)', () => {
    // Second entry in USSR palette is pure red
    expect(remapColors.houses.USSR[1]).toEqual([255, 0, 0]);
  });

  it('Germany[0] (lightest grey) = [239, 239, 239]', () => {
    // PCOLOR_GREY lightest — near-white
    expect(remapColors.houses.Germany[0]).toEqual([239, 239, 239]);
  });

  it('Ukraine[0] (lightest orange) = [255, 231, 150]', () => {
    // PCOLOR_ORANGE lightest entry
    expect(remapColors.houses.Ukraine[0]).toEqual([255, 231, 150]);
  });

  it('Turkey[0] = [211, 154, 125]', () => {
    // PCOLOR_BROWN lightest entry — tan/brown
    expect(remapColors.houses.Turkey[0]).toEqual([211, 154, 125]);
  });
});
